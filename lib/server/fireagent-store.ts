import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "./store";

/**
 * One JSON file per connected coin (data/mainnet-beta/fireagent/coins/<mint>.json).
 *
 * The web app only ever creates a file (on launch or connect); the agent process
 * (npm run fireagent) is the only writer after that. Keeping them to separate
 * operations means the two processes never overwrite each other.
 */

const DIR = path.join(DATA_DIR, "fireagent", "coins");

export interface Payout {
  at: number;
  lamports: number;
  recipients: number;
  signatures: string[];
}

export interface CoinRecord {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  description: string;
  image: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  /** Launched through the site, or an existing coin connected by its creator. */
  source: "launch" | "connect";
  connectedAt: number;

  // ---- written by the agent ----
  /** Creator fees pump.fun paid out through our distributions (both halves). */
  distributedLamports: number;
  /** The agent's half, received but not yet paid to holders. */
  holderPoolLamports: number;
  /** Paid to holders so far. */
  holderPaidLamports: number;
  /** Network fees the holder payouts cost (taken from the pool). */
  payoutFeesLamports: number;
  holders: number | null;
  lastDistributeAt: number | null;
  lastPayoutAt: number | null;
  /** Latest first, capped. */
  payouts: Payout[];
  /** Set when the coin's split no longer points at the agent (shouldn't happen: pump.fun locks it). */
  inactive?: string;
}

const MAX_PAYOUTS = 50;
const isMint = (m: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m);
const file = (mint: string) => {
  if (!isMint(mint)) throw new Error("bad mint");
  return path.join(DIR, `${mint}.json`);
};

export async function getCoin(mint: string): Promise<CoinRecord | null> {
  if (!isMint(mint)) return null;
  try {
    return JSON.parse(await fs.readFile(file(mint), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function listCoins(): Promise<CoinRecord[]> {
  let names: string[];
  try {
    names = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const coins = await Promise.all(names.map((n) => getCoin(n.slice(0, -5)).catch(() => null)));
  return coins.filter((c): c is CoinRecord => !!c).sort((a, b) => b.connectedAt - a.connectedAt);
}

type NewCoin = Pick<CoinRecord, "mint" | "creator" | "name" | "symbol" | "description" | "image" | "website" | "twitter" | "telegram" | "source">;

/** Register a coin (web app). No-op if it's already registered. Returns the stored record. */
export async function registerCoin(c: NewCoin): Promise<CoinRecord> {
  const rec: CoinRecord = {
    ...c,
    connectedAt: Date.now(),
    distributedLamports: 0,
    holderPoolLamports: 0,
    holderPaidLamports: 0,
    payoutFeesLamports: 0,
    holders: null,
    lastDistributeAt: null,
    lastPayoutAt: null,
    payouts: [],
  };
  await fs.mkdir(DIR, { recursive: true });
  try {
    await fs.writeFile(file(c.mint), JSON.stringify(rec, null, 2), { flag: "wx" });
    return rec;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return (await getCoin(c.mint))!;
    throw e;
  }
}

/** Atomic rewrite (agent only). */
export async function saveCoin(rec: CoinRecord) {
  rec.payouts = rec.payouts.slice(0, MAX_PAYOUTS);
  const f = file(rec.mint);
  const tmp = `${f}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rec, null, 2));
  await fs.rename(tmp, f);
}
