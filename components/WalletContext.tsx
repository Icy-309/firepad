"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { RPC_URL, WS_URL } from "@/lib/rpc";
import { ConnectModalProvider } from "./WalletUI";

export function AppWalletProvider({ children }: { children: React.ReactNode }) {
  // The site's /api/rpc proxy keeps the private mainnet RPC endpoint out of the browser bundle.
  const endpoint = useMemo(() => RPC_URL, []);
  const config = useMemo(() => ({ commitment: "confirmed" as const, wsEndpoint: WS_URL }), []);

  // Empty list: modern wallets (Phantom, Solflare, Backpack…) register themselves
  // through the Wallet Standard and are detected automatically — no explicit adapters,
  // which also keeps react-native / conflicting React types out of the dependency tree.
  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={[]} autoConnect>
        <ConnectModalProvider>{children}</ConnectModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
