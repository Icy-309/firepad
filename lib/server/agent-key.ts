import { PublicKey } from "@solana/web3.js";
import { AGENT_WALLET } from "@/lib/fireagent";

/** The FIREAGENT wallet as a key, or null when the server isn't configured. */
export function agentKey(): PublicKey | null {
  try {
    return AGENT_WALLET ? new PublicKey(AGENT_WALLET) : null;
  } catch {
    return null;
  }
}
