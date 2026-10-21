import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { parseSignedMessage, type SignedAction } from "@/lib/auth-message";
import { CLUSTER } from "@/lib/rpc";
import { processState } from "./process-state";

const MAX_AGE_MS = 5 * 60 * 1000;

export class AuthError extends Error {}

// ---------- one-time nonces (process-local) ----------

const MAX_NONCES = 10_000;
const nonces = processState("nonces", () => new Map<string, number>()); // nonce → expiry

export function issueNonce(): string {
  const now = Date.now();
  for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
  // Map keeps insertion order: drop the oldest if someone floods the endpoint.
  while (nonces.size >= MAX_NONCES) nonces.delete(nonces.keys().next().value as string);
  const nonce = randomBytes(16).toString("hex");
  nonces.set(nonce, now + MAX_AGE_MS);
  return nonce;
}

function consumeNonce(nonce: string): boolean {
  const exp = nonces.get(nonce);
  nonces.delete(nonce);
  return exp !== undefined && exp >= Date.now();
}

/** The host wallets must have signed for: NEXT_PUBLIC_SITE_URL's, else the request's own. */
function expectedHost(req: Request): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return new URL(site).host;
  return req.headers.get("host") || new URL(req.url).host;
}

/**
 * Verify a Sign-In With Solana message built by `buildSignedMessage`: right action,
 * domain, cluster and signer, fresh, valid ed25519 signature, and a nonce this
 * server issued that hasn't been used yet (so each signature works exactly once).
 */
export function verifySignedMessage(
  action: SignedAction,
  body: { wallet?: unknown; message?: unknown; signature?: unknown },
  req: Request
): string {
  const { wallet, signature } = body;
  if (typeof wallet !== "string" || typeof body.message !== "string" || typeof signature !== "string") {
    throw new AuthError("Missing wallet signature");
  }
  // multipart/form-data turns every "\n" in a field into "\r\n"; the wallet signed "\n".
  const message = body.message.replace(/\r\n/g, "\n");
  const parsed = parseSignedMessage(message);
  if (!parsed || parsed.action !== action || parsed.wallet !== wallet) throw new AuthError("Malformed signed message");
  if (parsed.domain !== expectedHost(req)) throw new AuthError("Signed for a different site");
  if (parsed.chainId !== `solana:${CLUSTER}`) throw new AuthError("Signed for a different network");
  if (Math.abs(Date.now() - parsed.ts) > MAX_AGE_MS) throw new AuthError("Signed message expired — sign again");

  let ok = false;
  try {
    ok = ed25519.verify(bs58.decode(signature), new TextEncoder().encode(message), bs58.decode(wallet));
  } catch {
    ok = false;
  }
  if (!ok) throw new AuthError("Invalid signature");
  // Checked last so a bad signature can't burn someone else's nonce.
  if (!consumeNonce(parsed.nonce)) throw new AuthError("Sign-in expired or already used — try again");
  return wallet;
}

// ---------- admin session ----------

const COOKIE = "fp_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

export function adminWallets(): Set<string> {
  return new Set(
    (process.env.ADMIN_WALLETS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("ADMIN_SESSION_SECRET must be set (32+ chars)");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function startAdminSession(wallet: string) {
  const payload = `${wallet}.${Date.now() + SESSION_MS}`;
  cookies().set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

export function endAdminSession() {
  cookies().delete(COOKIE);
}

/** The signed-in admin wallet, or null. Re-checks the allowlist on every call. */
export function currentAdmin(): string | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  const payload = raw.slice(0, i);
  const mac = Buffer.from(raw.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  const [wallet, exp] = payload.split(".");
  if (Date.now() > Number(exp) || !adminWallets().has(wallet)) return null;
  return wallet;
}

export function requireAdmin(): string {
  const w = currentAdmin();
  if (!w) throw new AuthError("Not signed in as admin");
  return w;
}
