import { Connection } from "@solana/web3.js";
import { RPC_URL } from "@/lib/rpc";

/** Server-side RPC (RPC_URL keeps a private endpoint out of the browser bundle). */
export const connection = new Connection(process.env.RPC_URL || RPC_URL, "confirmed");

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
let mainnetCheck: Promise<void> | undefined;

export class MainnetRpcError extends Error {
  constructor() {
    super("Configured Solana RPC is not connected to mainnet-beta.");
    this.name = "MainnetRpcError";
  }
}

export function assertMainnetConnection(): Promise<void> {
  if (!mainnetCheck) {
    mainnetCheck = connection.getGenesisHash().then((genesisHash) => {
      if (genesisHash !== MAINNET_GENESIS_HASH) {
        throw new MainnetRpcError();
      }
    }).catch((error: unknown) => {
      mainnetCheck = undefined;
      throw error;
    });
  }
  return mainnetCheck;
}
