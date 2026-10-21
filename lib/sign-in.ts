import bs58 from "bs58";
import { buildSignedMessage, type SignedAction } from "./auth-message";
import { CLUSTER } from "./rpc";

/**
 * Fetch a one-time nonce, have the wallet sign a Sign-In With Solana message for
 * `action`, and return the fields the API routes expect in the request body.
 */
export async function signRequest(
  action: SignedAction,
  wallet: string,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<{ wallet: string; message: string; signature: string }> {
  const res = await fetch("/api/auth/nonce", { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.nonce !== "string") throw new Error(body.error || "Could not start sign-in");
  const message = buildSignedMessage(action, wallet, {
    domain: window.location.host,
    uri: window.location.origin,
    chainId: `solana:${CLUSTER}`,
    nonce: body.nonce,
    issuedAt: new Date().toISOString(),
  });
  const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
  return { wallet, message, signature };
}
