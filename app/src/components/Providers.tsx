import { useCallback, useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { WalletError } from "@solana/wallet-adapter-base";
import type { ConnectionConfig } from "@solana/web3.js";
import { RPC_URL } from "../config";
import { guardedFetch } from "../lib/network";
import { isUserRejection, notify } from "../lib/notify";

// Signing and sending failures are reported by the flow that asked for them.
const HANDLED_BY_CALLER = new Set([
  "WalletNotSelectedError",
  "WalletSignTransactionError",
  "WalletSendTransactionError",
  "WalletSignMessageError",
  "WalletSignInError",
]);

// Every RPC request goes through the offline-mode guard.
const connectionConfig: ConnectionConfig = {
  commitment: "confirmed",
  fetch: guardedFetch as ConnectionConfig["fetch"],
};

export function Providers({ children }: { children: ReactNode }) {
  // Empty array enables Wallet Standard auto-detection for modern Solana extensions
  // (Phantom, Solflare, Backpack, etc.) without inflating the bundle.
  const wallets = useMemo(() => [], []);

  // Surface wallet failures in the UI; on phones there is no console to read them in.
  // Connection trouble is a toast, not a pop-up: a refused silent auto-connect
  // on page load lands here too and shouldn't interrupt anyone.
  const onError = useCallback((error: WalletError) => {
    console.error(error);
    if (HANDLED_BY_CALLER.has(error.name)) return;
    if (isUserRejection(error) || error.name === "WalletWindowClosedError") {
      notify.info("Wallet request cancelled", undefined, { key: "wallet" });
    } else if (error.name === "WalletNotReadyError") {
      notify.warning("Wallet not available", "Install or open your wallet app, then try again.", { key: "wallet" });
    } else {
      notify.error("Couldn't connect your wallet", error.message || "Open your wallet app and try again.", { key: "wallet" });
    }
  }, []);

  return (
    <ConnectionProvider
      endpoint={RPC_URL}
      config={connectionConfig}
    >
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
