import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { chainNow } from "../lib/pat";
import { loadCachedHistory, syncWalletHistory, type WalletHistory } from "../lib/chainHistory";
import { mergeChainIntoLedgers } from "../lib/ledger";

export function useWalletHistory(online: boolean, onLedgersChanged: () => void) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  const [history, setHistory] = useState<WalletHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const run = useRef(0);
  const changed = useRef(onLedgersChanged);
  changed.current = onLedgersChanged;

  const refresh = useCallback(async () => {
    const id = ++run.current;
    if (!wallet) {
      setHistory(null);
      setReady(false);
      return;
    }
    const cached = await loadCachedHistory(wallet);
    if (id !== run.current) return;
    setHistory(cached);
    if (!online) {
      setReady(true);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const fresh = await syncWalletHistory(connection, wallet);
      const clockOffset = (await chainNow(connection)) - Math.floor(Date.now() / 1000);
      await mergeChainIntoLedgers(wallet, fresh, { clockOffset });
      if (id !== run.current) return;
      setHistory(fresh);
      changed.current();
    } catch (e) {
      if (id === run.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === run.current) {
        setLoading(false);
        setReady(true);
      }
    }
  }, [connection, wallet, online]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { history, loading, error, ready, refresh };
}
