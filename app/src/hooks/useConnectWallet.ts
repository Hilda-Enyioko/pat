import { useCallback, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { WalletName } from "@solana/wallet-adapter-base";
import { notify } from "../lib/notify";

// Name the wallet adapter gives the Mobile Wallet Adapter (MWA) entry. It is
// only offered on Android mobile browsers with no injected wallet; connecting
// through it opens the installed wallet app (Phantom, Solflare…) and Android
// returns to the browser once the user approves.
export const MOBILE_WALLET_ADAPTER = "Mobile Wallet Adapter" as WalletName;

/**
 * Connect from a tap.
 * - A wallet already selected but not connected (on phones the silent
 *   auto-connect is refused without a gesture): connect() inside the tap.
 * - Android browser with MWA available: go straight to the wallet app instead
 *   of showing a picker whose only real entry is "Mobile Wallet Adapter".
 * - Otherwise open the wallet picker.
 */
export function useConnectWallet() {
  const { wallet, wallets, connected, connecting, connect, select } = useWallet();
  const { setVisible } = useWalletModal();
  const requested = useRef(false);

  const mobileWallet = wallets.find((w) => w.adapter.name === MOBILE_WALLET_ADAPTER);

  const connectWallet = useCallback(() => {
    if (connected || connecting) return;
    if (wallet && (wallet.readyState === "Installed" || wallet.readyState === "Loadable")) {
      requested.current = true;
      // Failures are reported through WalletProvider's onError.
      connect().catch(() => undefined);
      return;
    }
    if (mobileWallet) {
      requested.current = true;
      // Selecting makes the provider connect right away, still inside this tap's
      // activation window, which Chrome needs to hand off to the wallet app.
      select(MOBILE_WALLET_ADAPTER);
      return;
    }
    setVisible(true);
  }, [wallet, mobileWallet, connected, connecting, connect, select, setVisible]);

  const chooseWallet = useCallback(() => {
    requested.current = true;
    setVisible(true);
  }, [setVisible]);

  // Confirm the round trip once the user is back from the wallet app. Silent
  // reconnects on page load were not requested, so they stay quiet.
  useEffect(() => {
    if (!requested.current || !connected) return;
    requested.current = false;
    notify.success("Wallet connected", "You're ready to go.", { key: "wallet" });
  }, [connected]);

  return { connectWallet, chooseWallet, usesMobileWallet: Boolean(mobileWallet) };
}
