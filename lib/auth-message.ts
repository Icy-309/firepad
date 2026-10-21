/**
 * Shared (client + server) wallet-signed request messages, in Sign-In With Solana
 * format. Wallets that understand it (Phantom, Solflare, Backpack…) warn the user
 * when the `domain` line doesn't match the site asking for the signature, which is
 * what stops another site from phishing a valid FIREAGENT login.
 */

export type SignedAction = "launch" | "admin-login" | "x-connect" | "x-disconnect";

const STATEMENTS: Record<SignedAction, string> = {
  launch: "Reserve a FIREAGENT launch address.",
  "admin-login": "Sign in to the FIREAGENT admin panel.",
  "x-connect": "Connect an X account so FIREAGENT can post about your coins.",
  "x-disconnect": "Disconnect your X account from FIREAGENT.",
};

export interface SignInFields {
  domain: string;
  uri: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
}

export function buildSignedMessage(action: SignedAction, wallet: string, f: SignInFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    wallet,
    "",
    STATEMENTS[action],
    "",
    `URI: ${f.uri}`,
    "Version: 1",
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  ].join("\n");
}

export interface ParsedSignIn extends SignInFields {
  action: SignedAction;
  wallet: string;
  ts: number;
}

const RE =
  /^(\S+) wants you to sign in with your Solana account:\n([1-9A-HJ-NP-Za-km-z]{32,44})\n\n(.+)\n\nURI: (\S+)\nVersion: 1\nChain ID: (\S+)\nNonce: ([A-Za-z0-9]{16,64})\nIssued At: (\S+)$/;

export function parseSignedMessage(message: string): ParsedSignIn | null {
  const m = RE.exec(message);
  if (!m) return null;
  const action = (Object.keys(STATEMENTS) as SignedAction[]).find((a) => STATEMENTS[a] === m[3]);
  const ts = Date.parse(m[7]);
  if (!action || Number.isNaN(ts)) return null;
  return { domain: m[1], wallet: m[2], action, uri: m[4], chainId: m[5], nonce: m[6], issuedAt: m[7], ts };
}
