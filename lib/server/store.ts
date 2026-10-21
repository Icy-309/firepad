import { promises as fs } from "fs";
import path from "path";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { processState } from "./process-state";

/**
 * File-backed mainnet store (data/mainnet-beta/store.json) for the vanity-mint pool, token metadata
 * and moderation. Works on a single long-running server (VPS, `next start`).
 * On free or serverless hosts the filesystem is ephemeral — swap these functions
 * for Postgres/Redis; every caller goes through this async API.
 */

export const DATA_DIR = path.join(process.cwd(), "data", "mainnet-beta");
const STORE_FILE = path.join(DATA_DIR, "store.json");
/** Drop solana-keygen JSON keypairs here (`npm run grind` writes here too). */
export const VANITY_INCOMING_DIR = path.join(DATA_DIR, "vanity", "incoming");
export const VANITY_SUFFIX = process.env.VANITY_SUFFIX || "fire";

export interface VanityKey {
  pubkey: string;
  /** base58 64-byte secret key. Removed once issued. */
  secret: string;
}

export interface IssuedKey {
  pubkey: string;
  creator: string;
  issuedAt: number;
  /**
   * Kept until the mint shows up on-chain, so an address whose launch was never
   * sent can go back into the pool (see reclaimStaleKeys). Deleted once confirmed.
   */
  secret?: string;
}

export interface TokenMetadataRecord {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  description: string;
  image: string;
  /** Optional socials (normalized https URLs, "" when unset). Absent on older records. */
  website?: string;
  twitter?: string;
  telegram?: string;
  createdAt: number;
}

interface StoreShape {
  vanity: { available: VanityKey[]; issued: IssuedKey[] };
  metadata: Record<string, TokenMetadataRecord>;
  hidden: string[];
}

const empty = (): StoreShape => ({ vanity: { available: [], issued: [] }, metadata: {}, hidden: [] });

// All mutations go through one in-process queue so concurrent requests can't
// hand out the same keypair or clobber each other's writes. Process-wide, so every
// API route shares it (see process-state.ts).
const lock = processState("storeQueue", () => ({ queue: Promise.resolve() as Promise<unknown> }));
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.queue.then(fn, fn);
  lock.queue = run.catch(() => undefined);
  return run;
}

async function load(): Promise<StoreShape> {
  try {
    return { ...empty(), ...JSON.parse(await fs.readFile(STORE_FILE, "utf8")) };
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw e;
  }
}

async function save(s: StoreShape) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2));
  await fs.rename(tmp, STORE_FILE);
}

type AfterSave = (cb: () => Promise<void>) => void;

/** Load → mutate → save under the lock; `afterSave` callbacks run only once the write landed. */
const mutate = <T>(fn: (s: StoreShape, afterSave: AfterSave) => T | Promise<T>) =>
  exclusive(async () => {
    const s = await load();
    const after: (() => Promise<void>)[] = [];
    const out = await fn(s, (cb) => after.push(cb));
    await save(s);
    await Promise.all(after.map((cb) => cb().catch(() => undefined)));
    return out;
  });

const read = () => exclusive(load);

// ---------- vanity pool ----------

/** Validate a 64-byte secret key: correct pubkey half and the required suffix. */
export function parseVanitySecret(bytes: Uint8Array): VanityKey {
  if (bytes.length !== 64) throw new Error("keypair must be 64 bytes");
  const derived = ed25519.getPublicKey(bytes.subarray(0, 32));
  if (!derived.every((b, i) => b === bytes[32 + i])) throw new Error("keypair halves don't match");
  const pubkey = bs58.encode(bytes.subarray(32));
  if (!pubkey.endsWith(VANITY_SUFFIX)) throw new Error(`${pubkey} doesn't end with "${VANITY_SUFFIX}"`);
  return { pubkey, secret: bs58.encode(bytes) };
}

function addKeys(s: StoreShape, keys: VanityKey[]): number {
  const seen = new Set([...s.vanity.available.map((k) => k.pubkey), ...s.vanity.issued.map((k) => k.pubkey)]);
  let added = 0;
  for (const k of keys) {
    if (seen.has(k.pubkey)) continue;
    seen.add(k.pubkey);
    s.vanity.available.push(k);
    added++;
  }
  return added;
}

/** Move keypair files from the mainnet vanity incoming directory into the pool. */
async function ingestIncoming(s: StoreShape, afterSave: AfterSave): Promise<number> {
  let files: string[];
  try {
    files = (await fs.readdir(VANITY_INCOMING_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return 0;
  }
  const keys: VanityKey[] = [];
  const parsed: string[] = [];
  for (const f of files) {
    const full = path.join(VANITY_INCOMING_DIR, f);
    try {
      keys.push(parseVanitySecret(Uint8Array.from(JSON.parse(await fs.readFile(full, "utf8")))));
      parsed.push(f);
    } catch (e) {
      // Left in place: it may still be being written, or need a human to look at it.
      console.warn(`[vanity] skipping ${f}: ${(e as Error).message}`);
    }
  }
  const added = addKeys(s, keys);
  // Delete only the files we took, and only once the store holding them is on disk.
  afterSave(async () => {
    await Promise.all(parsed.map((f) => fs.unlink(path.join(VANITY_INCOMING_DIR, f))));
  });
  return added;
}

export function importVanityKeys(keys: VanityKey[]) {
  return mutate((s) => addKeys(s, keys));
}

export class PoolEmptyError extends Error {}
export class RateLimitError extends Error {}

const ISSUE_WINDOW_MS = 60 * 60 * 1000;
const MAX_ISSUED_PER_WINDOW = Number(process.env.VANITY_MAX_PER_HOUR || 5);
/** Pool-wide cap, so even many wallets can't empty the pool in a burst. */
const MAX_ISSUED_PER_MINUTE = Number(process.env.VANITY_MAX_PER_MINUTE || 10);
/**
 * Unused addresses go back into the pool after this long. Far beyond a blockhash's
 * ~1–2 minute life, so the original launch transaction can no longer land.
 */
const RECLAIM_AFTER_MS = 30 * 60 * 1000;

/**
 * Hand one keypair to `creator` and record its metadata atomically. The key is
 * never reissued, even if the launch tx is never sent: after creation the mint
 * keypair has no authority, so giving its secret to the client is safe.
 */
export function issueVanityKey(
  creator: string,
  meta: Omit<TokenMetadataRecord, "mint" | "creator" | "createdAt">,
  /** Which of the given mints already exist on-chain (to know a held address is still unused). */
  existing?: (mints: string[]) => Promise<Set<string>>
): Promise<VanityKey> {
  return mutate(async (s, afterSave) => {
    await ingestIncoming(s, afterSave);
    const now = Date.now();

    // A retry (e.g. the wallet popup hung last time) gets the address this wallet already
    // holds instead of a new one, so failed attempts don't burn addresses or the limit.
    const held = s.vanity.issued.filter((k) => k.creator === creator && k.secret && now - k.issuedAt < RECLAIM_AFTER_MS);
    if (held.length && existing) {
      const live = await existing(held.map((k) => k.pubkey));
      for (const k of held) {
        if (live.has(k.pubkey)) {
          delete k.secret; // it did launch after all
          continue;
        }
        k.issuedAt = now; // restart its reclaim clock
        s.metadata[k.pubkey] = { ...meta, mint: k.pubkey, creator, createdAt: now };
        return { pubkey: k.pubkey, secret: k.secret! };
      }
    }

    const recent = s.vanity.issued.filter((k) => k.creator === creator && now - k.issuedAt < ISSUE_WINDOW_MS);
    if (recent.length >= MAX_ISSUED_PER_WINDOW) throw new RateLimitError("Too many launches from this wallet — try again later");
    const lastMinute = s.vanity.issued.filter((k) => now - k.issuedAt < 60_000).length;
    if (lastMinute >= MAX_ISSUED_PER_MINUTE) throw new RateLimitError("Launches are busy right now — try again in a minute");
    const key = s.vanity.available.shift();
    if (!key) throw new PoolEmptyError("Vanity address pool is empty");
    s.vanity.issued.push({ pubkey: key.pubkey, creator, issuedAt: now, secret: key.secret });
    s.metadata[key.pubkey] = { ...meta, mint: key.pubkey, creator, createdAt: now };
    return key;
  });
}

/** Put every address this wallet holds that never launched back into the pool (resets its limit). */
export function releaseUnlaunched(creator: string, existing: (mints: string[]) => Promise<Set<string>>) {
  return mutate(async (s) => {
    const held = s.vanity.issued.filter((k) => k.creator === creator && k.secret);
    if (!held.length) return 0;
    const live = await existing(held.map((k) => k.pubkey));
    let released = 0;
    for (const k of held) {
      if (live.has(k.pubkey)) {
        delete k.secret;
        continue;
      }
      s.vanity.issued = s.vanity.issued.filter((x) => x !== k);
      delete s.metadata[k.pubkey];
      s.vanity.available.unshift({ pubkey: k.pubkey, secret: k.secret! });
      released++;
    }
    return released;
  });
}

/** Undo an issue whose launch can't proceed (e.g. metadata upload failed): back to the front of the pool. */
export function releaseVanityKey(pubkey: string) {
  return mutate((s) => {
    const i = s.vanity.issued.findIndex((k) => k.pubkey === pubkey);
    if (i < 0) return false;
    const [k] = s.vanity.issued.splice(i, 1);
    delete s.metadata[pubkey];
    if (k.secret) s.vanity.available.unshift({ pubkey, secret: k.secret });
    return true;
  });
}

/**
 * Settle addresses issued more than RECLAIM_AFTER_MS ago: forget the secret of
 * those that launched, and put the rest back at the end of the pool.
 * `existing` reports which of the given mints exist on-chain.
 */
export function reclaimStaleKeys(existing: (mints: string[]) => Promise<Set<string>>) {
  return mutate(async (s) => {
    const now = Date.now();
    const stale = s.vanity.issued.filter((k) => k.secret && now - k.issuedAt > RECLAIM_AFTER_MS).slice(0, 100);
    if (!stale.length) return { confirmed: 0, reclaimed: 0 };
    const live = await existing(stale.map((k) => k.pubkey));
    let confirmed = 0;
    let reclaimed = 0;
    for (const k of stale) {
      if (live.has(k.pubkey)) {
        delete k.secret;
        confirmed++;
      } else {
        s.vanity.issued = s.vanity.issued.filter((x) => x !== k);
        delete s.metadata[k.pubkey];
        s.vanity.available.push({ pubkey: k.pubkey, secret: k.secret! });
        reclaimed++;
      }
    }
    return { confirmed, reclaimed };
  });
}

export async function vanityStats() {
  const s = await mutate(async (st, afterSave) => {
    await ingestIncoming(st, afterSave);
    return st;
  });
  return {
    suffix: VANITY_SUFFIX,
    available: s.vanity.available.length,
    issued: s.vanity.issued.length,
    // Never send secrets to the admin UI.
    recentIssued: s.vanity.issued.slice(-20).reverse().map(({ pubkey, creator, issuedAt }) => ({ pubkey, creator, issuedAt })),
  };
}

// ---------- metadata ----------

export async function getMetadata(mint: string) {
  const all = (await read()).metadata;
  return Object.hasOwn(all, mint) ? all[mint] : null;
}

export async function listMetadata() {
  return Object.values((await read()).metadata).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- moderation ----------

export async function getHidden(): Promise<Set<string>> {
  return new Set((await read()).hidden);
}

export function setHidden(mint: string, hidden: boolean) {
  return mutate((s) => {
    s.hidden = s.hidden.filter((m) => m !== mint);
    if (hidden) s.hidden.push(mint);
    return s.hidden;
  });
}
