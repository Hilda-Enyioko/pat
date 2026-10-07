import { type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { RPC_URL } from "../config";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={[new PhantomWalletAdapter(), new SolflareWalletAdapter()]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
