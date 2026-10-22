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
  const onError = useCallback((error: WalletError) => {
    console.error(error);
    if (error.name === "WalletNotSelectedError") return;
    window.dispatchEvent(new CustomEvent("pat:wallet-error", { detail: error }));
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
