import { promises as fs } from "fs";
import path from "path";

/**
 * Per-token holder-reward state, written by the keeper (scripts/keeper.ts) and
 * read by the proof API. One file per mint: data/rewards/<mint>.json.
 * BigInts are stored as decimal strings.
 */

const DIR = path.join(process.cwd(), "data", "rewards");

export interface RewardsState {
  /** Last epoch confirmed on-chain, and its root (hex). */
  epoch: number;
  root: string | null;
  /** wallet → cumulative lamports allocated (all epochs). */
  allocations: Record<string, string>;
  /** Sum of `allocations` = holder SOL already distributed into roots. */
  allocated: string;
  /** wallet → Σ balance × ms since the last epoch (time-weighting). */
  balanceMs: Record<string, string>;
  /**
   * wallet → raw balance at the last sample. Each interval is credited at the
   * balance held at its *start*, so buying right before a sample earns nothing for it.
   */
  lastBalances: Record<string, string>;
  lastSampleAt: number;
  lastEpochAt: number;
  /** Eligible wallets with a balance at the last sample. */
  holders: number;
  /** Root sent but not yet seen on-chain (crash-safe two-phase commit). */
  pending: { epoch: number; root: string; allocations: Record<string, string>; allocated: string } | null;
}

export const emptyRewards = (): RewardsState => ({
  epoch: 0,
  root: null,
  allocations: {},
  allocated: "0",
  balanceMs: {},
  lastBalances: {},
  lastSampleAt: 0,
  lastEpochAt: Date.now(),
  holders: 0,
  pending: null,
});

const file = (mint: string) => {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new Error("bad mint");
  return path.join(DIR, `${mint}.json`);
};

export async function loadRewards(mint: string): Promise<RewardsState> {
  try {
    return { ...emptyRewards(), ...JSON.parse(await fs.readFile(file(mint), "utf8")) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyRewards();
    throw e;
  }
}

export async function saveRewards(mint: string, s: RewardsState) {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${file(mint)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s));
  await fs.rename(tmp, file(mint));
}

// ---------- keeper status (shown in /admin) ----------

const STATUS_FILE = path.join(process.cwd(), "data", "keeper-status.json");

export interface KeeperStatus {
  keeper: string;
  lastTickAt: number;
  tokens: Record<string, { holders: number; lastCollectAt?: number; lastEpochAt?: number; epoch: number; error?: string }>;
  swapEnabled: boolean;
}

export async function saveKeeperStatus(s: KeeperStatus) {
  await fs.mkdir(path.dirname(STATUS_FILE), { recursive: true });
  await fs.writeFile(STATUS_FILE, JSON.stringify(s, null, 2));
}

export async function loadKeeperStatus(): Promise<KeeperStatus | null> {
  try {
    return JSON.parse(await fs.readFile(STATUS_FILE, "utf8"));
  } catch {
    return null;
  }
}
