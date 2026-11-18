import { useCallback, useEffect, useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { GATEWAY_URL } from "../config";
import { activateMerchant, activationMessage, merchantMe, type MerchantCode } from "../lib/gateway";

const KEY = (wallet: string) => `pat:merchant-code:${wallet}`;
const read = (wallet: string): MerchantCode | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY(wallet)) || "null");
  } catch {
    return null;
  }
};
const write = (m: MerchantCode) => {
  try {
    localStorage.setItem(KEY(m.wallet), JSON.stringify(m));
  } catch {
    /* refetched next time */
  }
};

// One request per wallet per page load, shared by the header and the merchant page.
const inflight = new Map<string, Promise<MerchantCode>>();
const listeners = new Set<(m: MerchantCode) => void>();
const publish = (m: MerchantCode) => {
  write(m);
  listeners.forEach((l) => l(m));
};

function load(wallet: string) {
  let p = inflight.get(wallet);
  if (!p) {
    p = merchantMe(wallet).then((m) => {
      publish(m);
      return m;
    });
    p.catch(() => inflight.delete(wallet));
    inflight.set(wallet, p);
  }
  return p;
}

/**
 * The connected wallet's USSD merchant code. Every wallet gets one automatically
 * (free, off-chain); activating puts it on-chain so USSD payers can pay it.
 */
export function useMerchantCode(online: boolean) {
  const { publicKey, signMessage } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [code, setCode] = useState<MerchantCode | null>(() => (wallet ? read(wallet) : null));
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    setCode(wallet ? read(wallet) : null);
    setError(null);
    if (!wallet) return;
    const onUpdate = (m: MerchantCode) => m.wallet === wallet && setCode(m);
    listeners.add(onUpdate);
    if (online && GATEWAY_URL) {
      load(wallet).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
    return () => {
      listeners.delete(onUpdate);
    };
  }, [wallet, online]);

  const activate = useCallback(async () => {
    if (!wallet || !code || !signMessage) throw new Error("Connect a wallet that can sign messages (Phantom or Solflare).");
    setActivating(true);
    try {
      const sig = await signMessage(new TextEncoder().encode(activationMessage(code.code, wallet)));
      const res = await activateMerchant(wallet, bs58.encode(sig));
      const next: MerchantCode = { wallet, code: res.code, status: res.status, canActivate: code.canActivate };
      publish(next);
      return res;
    } catch (e) {
      // "code_taken": the gateway handed out a new code; pick it up.
      if ((e as { code?: string }).code === "code_taken") {
        inflight.delete(wallet);
        await load(wallet).catch(() => undefined);
      }
      throw e;
    } finally {
      setActivating(false);
    }
  }, [wallet, code, signMessage]);

  return { code, error, activating, activate, canSign: typeof signMessage === "function", enabled: Boolean(GATEWAY_URL) };
}
