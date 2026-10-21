import { clusterApiUrl, type Cluster } from "@solana/web3.js";

export const CLUSTER: Cluster = "mainnet-beta";

/**
 * RPC endpoint. In the browser, default to this site's /api/rpc proxy, which forwards to the
 * server's RPC_URL (Helius) without exposing its key. On the server, use RPC_URL or the
 * public mainnet endpoint as a fallback.
 */
export const RPC_URL =
  // ?cluster=… matters: wallet adapters infer the network from the endpoint URL (a bare
  // localhost URL would be read as "localnet", which Phantom rejects).
  (typeof window !== "undefined"
    ? `${window.location.origin}/api/rpc?cluster=${CLUSTER}`
    : clusterApiUrl(CLUSTER));

/** Websocket for confirmations (signature subscriptions are light; the public endpoint is fine). */
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || clusterApiUrl(CLUSTER).replace(/^http/, "ws");

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;
