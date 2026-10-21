import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "../store";
import { processState } from "../process-state";

/**
 * X (Twitter) API v2 posting for the marketing agent.
 *  - Official account: OAuth 1.0a user context (X_API_KEY/SECRET + X_ACCESS_TOKEN/SECRET).
 *  - Creators' own accounts: OAuth 2.0 + PKCE (X_CLIENT_ID/SECRET), tokens encrypted at rest.
 * With no credentials configured, posts go to the outbox only (dry run).
 */

const API = "https://api.x.com/2";
const AUTHORIZE = "https://x.com/i/oauth2/authorize";
const SCOPES = "tweet.read tweet.write users.read offline.access";

export const officialEnabled = () =>
  !!(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET);
export const creatorOAuthEnabled = () => !!process.env.X_CLIENT_ID;

// ---------------------------------------------------------------------------
// OAuth 1.0a (official account)

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function oauth1Header(method: string, url: string): string {
  const params: Record<string, string> = {
    oauth_consumer_key: process.env.X_API_KEY!,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.X_ACCESS_TOKEN!,
    oauth_version: "1.0",
  };
  // JSON bodies aren't part of the signature; only oauth_* params (no query string here).
  const base = [method, enc(url), enc(Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&"))].join("&");
  const key = `${enc(process.env.X_API_SECRET!)}&${enc(process.env.X_ACCESS_SECRET!)}`;
  params.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(params).sort().map((k) => `${enc(k)}="${enc(params[k])}"`).join(", ");
}

// ---------------------------------------------------------------------------
// Posting

export class XError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function postTweet(auth: string, text: string, replyTo?: string): Promise<string> {
  const res = await fetch(`${API}/tweets`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(replyTo ? { text, reply: { in_reply_to_tweet_id: replyTo } } : { text }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { id: string }; detail?: string; title?: string };
  if (!res.ok || !body.data?.id) throw new XError(`X ${res.status}: ${body.detail || body.title || "post failed"}`, res.status);
  return body.data.id;
}

/** Post a single tweet or a thread (each reply to the previous). Returns the tweet ids. */
async function postThread(getAuth: () => Promise<string>, posts: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const text of posts) ids.push(await postTweet(await getAuth(), text, ids[ids.length - 1]));
  return ids;
}

export const postOfficial = (posts: string[]) =>
  postThread(async () => oauth1Header("POST", `${API}/tweets`), posts);

export async function postAsCreator(wallet: string, posts: string[]): Promise<string[]> {
  return postThread(async () => `Bearer ${await creatorAccessToken(wallet)}`, posts);
}

// ---------------------------------------------------------------------------
// Creator accounts: encrypted token store

interface XAccount {
  wallet: string;
  xUserId: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  connectedAt: number;
}

const STORE = path.join(DATA_DIR, "agent", "x-accounts.json");

function cipherKey(): Buffer {
  const secret = process.env.AGENT_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Set AGENT_SECRET (32+ chars) to store X tokens");
  return createHash("sha256").update(`firepad-x-tokens:${secret}`).digest();
}
function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
function open(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", cipherKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

const lock = processState("xStoreLock", () => ({ q: Promise.resolve() as Promise<unknown> }));
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.q.then(fn, fn);
  lock.q = run.catch(() => undefined);
  return run;
}
async function readAll(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(STORE, "utf8"));
  } catch {
    return {};
  }
}
async function writeAll(all: Record<string, string>) {
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  const tmp = `${STORE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(all, null, 2));
  await fs.rename(tmp, STORE);
}

export async function getXAccount(wallet: string): Promise<XAccount | null> {
  const sealed = (await readAll())[wallet];
  if (!sealed) return null;
  try {
    return JSON.parse(open(sealed));
  } catch {
    return null;
  }
}
const saveXAccount = (a: XAccount) =>
  exclusive(async () => {
    const all = await readAll();
    all[a.wallet] = seal(JSON.stringify(a));
    await writeAll(all);
  });
export const removeXAccount = (wallet: string) =>
  exclusive(async () => {
    const all = await readAll();
    delete all[wallet];
    await writeAll(all);
  });

// ---------------------------------------------------------------------------
// OAuth 2.0 + PKCE

const pending = processState("xOAuthPending", () => new Map<string, { wallet: string; verifier: string; returnTo: string; exp: number }>());
const b64url = (b: Buffer) => b.toString("base64url");

export function redirectUri(origin: string) {
  return `${origin}/api/agent/x/callback`;
}

/** Start linking `wallet` to an X account; returns the URL to send the browser to. */
export function startConnect(wallet: string, origin: string, returnTo: string): string {
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  pending.set(state, { wallet, verifier, returnTo, exp: now + 10 * 60_000 });
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    scope: SCOPES,
    state,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE}?${q}`;
}

async function tokenRequest(form: Record<string, string>) {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (process.env.X_CLIENT_SECRET) {
    headers.Authorization = "Basic " + Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
  }
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers,
    body: new URLSearchParams({ ...form, client_id: process.env.X_CLIENT_ID! }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) throw new XError(`X token ${res.status}: ${body.error_description || "failed"}`, res.status);
  return body;
}

/** Finish the OAuth callback: exchange the code, look up the user, store the tokens. */
export async function finishConnect(state: string, code: string, origin: string) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.exp < Date.now()) throw new XError("This X sign-in link expired. Try connecting again.", 400);
  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin), code_verifier: p.verifier });
  const me = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const user = (await me.json().catch(() => ({}))) as { data?: { id: string; username: string } };
  if (!user.data) throw new XError("Couldn't read your X profile", me.status);
  await saveXAccount({
    wallet: p.wallet,
    xUserId: user.data.id,
    username: user.data.username,
    accessToken: tok.access_token!,
    refreshToken: tok.refresh_token ?? "",
    expiresAt: Date.now() + (tok.expires_in ?? 7200) * 1000,
    connectedAt: Date.now(),
  });
  return { wallet: p.wallet, username: user.data.username, returnTo: p.returnTo };
}

async function creatorAccessToken(wallet: string): Promise<string> {
  const a = await getXAccount(wallet);
  if (!a) throw new XError("Creator hasn't connected X", 404);
  if (a.expiresAt - Date.now() > 60_000) return a.accessToken;
  if (!a.refreshToken) throw new XError("X session expired; reconnect", 401);
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: a.refreshToken });
  const next = {
    ...a,
    accessToken: tok.access_token!,
    refreshToken: tok.refresh_token ?? a.refreshToken,
    expiresAt: Date.now() + (tok.expires_in ?? 7200) * 1000,
  };
  await saveXAccount(next);
  return next.accessToken;
}
