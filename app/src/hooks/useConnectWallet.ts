import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

/**
 * Connect from a tap. If a wallet is already selected but not connected (the
 * usual state on phones, where the silent auto-connect is refused because it
 * had no user gesture), call connect() right inside the tap so the wallet app
 * can open; picking the same wallet again in the modal would do nothing.
 * Otherwise open the wallet picker.
 */
export function useConnectWallet() {
  const { wallet, connected, connecting, connect } = useWallet();
  const { setVisible } = useWalletModal();

  const connectWallet = useCallback(() => {
    if (connected || connecting) return;
    if (wallet && (wallet.readyState === "Installed" || wallet.readyState === "Loadable")) {
      // Failures are reported through WalletProvider's onError.
      connect().catch(() => undefined);
      return;
    }
    setVisible(true);
  }, [wallet, connected, connecting, connect, setVisible]);

  const chooseWallet = useCallback(() => setVisible(true), [setVisible]);

  return { connectWallet, chooseWallet };
}
