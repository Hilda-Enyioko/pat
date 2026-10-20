import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
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

  return (
    <ConnectionProvider
      endpoint={RPC_URL}
      config={connectionConfig}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
