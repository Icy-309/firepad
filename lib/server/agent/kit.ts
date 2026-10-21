import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { DATA_DIR } from "../store";
import { processState } from "../process-state";
import { generate, RULES_SYSTEM } from "./prompt";
import { fitsX, vet } from "./guard";

/** Everything a creator needs to market a launch, generated once per coin. */
export interface LaunchKit {
  mint: string;
  tagline: string;
  lore: string;
  /** X thread, first post first. Each fits in one post. */
  thread: string[];
  /** Standalone short posts / meme captions. */
  captions: string[];
  /** On-screen lines for the short vertical video. */
  videoLines: string[];
  generatedBy: "claude" | "template";
  createdAt: number;
}

export interface CoinFacts {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  url: string; // coin page
  website?: string;
  twitter?: string;
  telegram?: string;
}

const DIR = path.join(DATA_DIR, "agent", "kits");
const file = (mint: string) => {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new Error("bad mint");
  return path.join(DIR, `${mint}.json`);
};

const KitSchema = z.object({
  tagline: z.string().describe("One punchy line, max 80 characters."),
  lore: z.string().describe("A short origin story / meme lore for the coin, 2-4 sentences."),
  thread: z.array(z.string()).describe("An X launch thread of 3-4 posts, each under 240 characters."),
  captions: z.array(z.string()).describe("5 standalone short posts or meme captions, each under 200 characters."),
  videoLines: z.array(z.string()).describe("4 very short on-screen lines for a 15-second vertical video, each under 40 characters."),
});

const factsBlock = (f: CoinFacts) =>
  [
    `Coin: ${f.name} ($${f.symbol})`,
    `Description from the creator: ${f.description || "(none)"}`,
    `Contract address (ends in "fire"): ${f.mint}`,
    `Coin page: ${f.url}`,
    `A pump.fun coin on FIREPAD. pump.fun's own fee sharing splits the coin's creator fee 50/50: half to the creator, half to the FIREAGENT payout wallet, which distributes it to holders by balance. pump.fun locks the split, so nobody can change it.`,
    `When the bonding curve completes, the coin graduates to PumpSwap and the split keeps paying there.`,
    f.twitter ? `X: ${f.twitter}` : "",
    f.telegram ? `Telegram: ${f.telegram}` : "",
    f.website ? `Website: ${f.website}` : "",
  ]
    .filter(Boolean)
    .join("\n");

function templateKit(f: CoinFacts): Omit<LaunchKit, "generatedBy" | "createdAt"> {
  const ca = `CA: ${f.mint}`;
  return {
    mint: f.mint,
    tagline: `${f.name} pays the people who hold it.`,
    lore: `${f.name} was born with one rule: the people who hold it get paid. ${
      f.description ? f.description + " " : ""
    }Half of its creator fee goes to holders, paid out by FIREPAD, and pump.fun locks that split for good.`,
    thread: [
      `$${f.symbol} is live on pump.fun, powered by FIREPAD.\n\n${f.description || `${f.name} is a community coin on Solana.`}\n\n${f.url}`,
      `How it works: every trade pays pump.fun's creator fee. FIREPAD's split sends half to the creator and half to holders by balance. pump.fun locks the split, so it can't be changed.`,
      `Holders don't claim anything. The agent sends SOL straight to their wallets.`,
      `Contract address ends in "fire".\n${ca}`,
    ],
    captions: [
      `$${f.symbol}: hold it, get paid. Half of the creator fee goes to holders.\n${f.url}`,
      `Every $${f.symbol} trade pays the people holding it. That's the whole idea.`,
      `$${f.symbol} on FIREPAD. Creator fees split 50/50 with holders, locked by pump.fun.\n${f.url}`,
      `${f.name} lore drop: ${f.description || "a coin that pays its holders"}.`,
      `Check the CA, it ends in fire.\n${ca}`,
    ],
    videoLines: [`$${f.symbol} is live`, "Every trade pays holders", "50/50 split, locked", "CA ends in fire"],
  };
}

/** Keep only lines that pass the guardrails and fit X; fall back per field. */
function sanitize(k: z.infer<typeof KitSchema>, t: ReturnType<typeof templateKit>) {
  const ok = (s: string) => vet(s) !== null;
  const thread = k.thread.filter((s) => ok(s) && fitsX(s));
  const captions = k.captions.filter((s) => ok(s) && fitsX(s));
  const videoLines = k.videoLines.filter((s) => ok(s) && s.length <= 48);
  return {
    tagline: ok(k.tagline) && k.tagline.length <= 100 ? k.tagline : t.tagline,
    lore: ok(k.lore) ? k.lore : t.lore,
    thread: thread.length >= 2 ? thread : t.thread,
    captions: captions.length >= 3 ? captions : t.captions,
    videoLines: videoLines.length >= 3 ? videoLines : t.videoLines,
  };
}

const inflight = processState("kitInflight", () => new Map<string, Promise<LaunchKit>>());

export async function loadKit(mint: string): Promise<LaunchKit | null> {
  try {
    return JSON.parse(await fs.readFile(file(mint), "utf8"));
  } catch {
    return null;
  }
}

/** The coin's kit, generating (and caching) it on first request. */
export async function getKit(f: CoinFacts, regenerate = false): Promise<LaunchKit> {
  if (!regenerate) {
    const cached = await loadKit(f.mint);
    if (cached) return cached;
  }
  let p = inflight.get(f.mint);
  if (!p) {
    p = (async () => {
      const t = templateKit(f);
      const out = await generate(
        KitSchema,
        RULES_SYSTEM,
        `Write a launch marketing kit for this coin, using only these facts.\n\n${factsBlock(f)}\n\nInclude the coin page link in the first thread post and in at least two captions. The last thread post should give the contract address.`,
        "medium"
      );
      const kit: LaunchKit = out
        ? { mint: f.mint, ...sanitize(out, t), generatedBy: "claude", createdAt: Date.now() }
        : { ...t, generatedBy: "template", createdAt: Date.now() };
      await fs.mkdir(DIR, { recursive: true });
      const tmp = `${file(f.mint)}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(kit, null, 2));
      await fs.rename(tmp, file(f.mint));
      return kit;
    })().finally(() => inflight.delete(f.mint));
    inflight.set(f.mint, p);
  }
  return p;
}
