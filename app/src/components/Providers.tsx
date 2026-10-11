import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "../config";

export function Providers({ children }: { children: ReactNode }) {
  // Empty array enables Wallet Standard auto-detection for modern Solana extensions
  // (Phantom, Solflare, Backpack, etc.) without inflating the bundle.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider
      endpoint={RPC_URL}
      config={{ commitment: "confirmed" }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
