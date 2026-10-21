import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import type { Token } from "@/lib/types";
import { DATA_DIR } from "../store";
import { generate, RULES_SYSTEM } from "./prompt";
import { fitsX, vet } from "./guard";
import type { CoinFacts } from "./kit";

/** A thing worth announcing, derived only from on-chain facts. */
export interface Milestone {
  key: string; // unique per coin, e.g. "mc:25000"
  rank: number; // within a family, higher supersedes lower (post only the highest crossed)
  family: string;
  fact: string; // plain statement of what happened, fed to the writer
}

const MC_STEPS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const CURVE_STEPS = [50, 75, 90];
const HOLDER_STEPS = [0.1, 1, 5, 25, 100];

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `$${Math.round(n / 1000)}K`);

export function milestonesFor(t: Token, solUsd: number): Milestone[] {
  const out: Milestone[] = [{ key: "launch", family: "launch", rank: 0, fact: `$${t.symbol} just joined FIREPAD.` }];
  const mc = t.marketCapSol * solUsd;
  MC_STEPS.forEach((s, i) => {
    if (mc >= s) out.push({ key: `mc:${s}`, family: "mc", rank: i, fact: `$${t.symbol} passed a ${usd(s)} market cap.` });
  });
  if (!t.complete) {
    CURVE_STEPS.forEach((p, i) => {
      if (t.bondingProgress * 100 >= p)
        out.push({ key: `curve:${p}`, family: "curve", rank: i, fact: `$${t.symbol}'s bonding curve is ${p}% filled. At 100% it graduates to PumpSwap.` });
    });
  }
  if (t.complete) {
    out.push({
      key: "graduated",
      family: "graduated",
      rank: 0,
      fact: `$${t.symbol} graduated to PumpSwap.`,
    });
  }
  const earned = t.holderFeesSol ?? 0;
  HOLDER_STEPS.forEach((s, i) => {
    if (earned >= s) out.push({ key: `holders:${s}`, family: "holders", rank: i, fact: `$${t.symbol} holders have been paid ${s} SOL from creator fees so far.` });
  });
  return out;
}

/** Template post for a milestone (used without Claude, or when Claude's draft fails the guardrails). */
function templatePost(m: Milestone, f: CoinFacts): string {
  switch (m.family) {
    case "launch":
      return `New on FIREPAD: ${f.name} ($${f.symbol}).\n\n${f.description ? f.description.slice(0, 120) + "\n\n" : ""}Half of its creator fee goes to holders.\n${f.url}`;
    case "graduated":
      return `${m.fact}\n\nThe 50/50 split keeps paying holders after graduation.\n${f.url}`;
    default:
      return `${m.fact}\n\nHalf of $${f.symbol}'s creator fee goes to holders.\n${f.url}`;
  }
}

const PostSchema = z.object({ post: z.string().describe("The X post, under 240 characters, ending with the coin page link.") });

/** Write the post for a milestone. Claude when configured, templates otherwise; always guard-checked. */
export async function composePost(m: Milestone, f: CoinFacts, voice: "official" | "creator"): Promise<string> {
  const fallback = templatePost(m, f);
  const who =
    voice === "official"
      ? "You are posting from the official FIREPAD account, spotlighting a coin on the platform."
      : `You are posting from the creator's own account about their coin, ${f.name}. Write in first person plural ("we").`;
  const out = await generate(
    PostSchema,
    RULES_SYSTEM,
    `${who}\n\nWhat happened: ${m.fact}\nCoin: ${f.name} ($${f.symbol}). ${f.description ? `About: ${f.description}` : ""}\nCoin page link (must appear): ${f.url}\n\nWrite one X post announcing this.`,
    "low"
  );
  const text = out?.post && vet(out.post);
  return text && fitsX(text) && text.includes(f.url) ? text : fallback;
}

// ---------------------------------------------------------------------------
// Agent state + outbox (data/agent)

const STATE = path.join(DATA_DIR, "agent", "state.json");
const OUTBOX = path.join(DATA_DIR, "agent", "outbox.json");

export interface AgentState {
  /** mint → milestone key → result per account ("dry", a tweet id, "skipped", or "error: …"). */
  posted: Record<string, Record<string, { official?: string; creator?: string; at: number }>>;
  officialTimes: number[];
  creatorTimes: Record<string, number[]>;
  firstSeen: Record<string, number>;
}

export interface OutboxEntry {
  at: number;
  mint: string;
  symbol: string;
  milestone: string;
  account: string; // "official account" or "@username"
  posts: string[];
  result: "posted" | "dry-run" | "error";
  ids?: string[];
  error?: string;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return { ...fallback, ...JSON.parse(await fs.readFile(file, "utf8")) };
  } catch {
    return fallback;
  }
}
async function writeJson(file: string, v: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(v, null, 2));
  await fs.rename(tmp, file);
}

export const loadAgentState = () =>
  readJson<AgentState>(STATE, { posted: {}, officialTimes: [], creatorTimes: {}, firstSeen: {} });
export const saveAgentState = (s: AgentState) => writeJson(STATE, s);

export async function loadOutbox(): Promise<OutboxEntry[]> {
  try {
    return JSON.parse(await fs.readFile(OUTBOX, "utf8"));
  } catch {
    return [];
  }
}
export async function appendOutbox(e: OutboxEntry) {
  const all = await loadOutbox();
  all.unshift(e);
  await writeJson(OUTBOX, all.slice(0, 300));
}
