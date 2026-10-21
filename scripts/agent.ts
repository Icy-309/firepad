/**
 * FIREAGENT marketing agent — fully automatic community marketing for every launch.
 *
 *   npm run marketing
 *
 * Every tick, for each live coin (hidden coins are never promoted):
 *   - makes sure its Launch Kit exists (lore, X thread, captions, video lines);
 *   - finds on-chain milestones it hasn't announced (launch, market cap, curve progress,
 *     graduation to Raydium, holder earnings) and posts the next one:
 *       · from the official @firepad account (X_API_KEY/SECRET + X_ACCESS_TOKEN/SECRET), and
 *       · from the creator's own X if they connected it (the launch post is their kit thread).
 *
 * Without X credentials it runs as a dry run: posts go to data/agent/outbox.json (shown in
 * /admin). Without ANTHROPIC_API_KEY it writes with templates; with it, Claude writes the copy.
 * Every post passes guardrails (no price talk, no promises) and rate limits.
 *
 * Env: AGENT_TICK_SECONDS (120), AGENT_OFFICIAL_PER_HOUR (8), AGENT_CREATOR_PER_HOUR (3),
 * NEXT_PUBLIC_SITE_URL (links in posts), RPC_URL.
 */
import "./load-env"; // must be first
import { listLiveTokens } from "../lib/server/tokens";
import { getHidden } from "../lib/server/store";
import { getSolUsd } from "../lib/server/sol-price";
import { getKit } from "../lib/server/agent/kit";
import { toFacts } from "../lib/server/agent/facts";
import { claudeEnabled } from "../lib/server/agent/claude";
import {
  appendOutbox,
  composePost,
  loadAgentState,
  milestonesFor,
  saveAgentState,
  type AgentState,
  type Milestone,
} from "../lib/server/agent/posts";
import { creatorOAuthEnabled, getXAccount, officialEnabled, postAsCreator, postOfficial } from "../lib/server/agent/x";
import type { Token } from "../lib/types";

const TICK_MS = Number(process.env.AGENT_TICK_SECONDS || 120) * 1000;
const OFFICIAL_PER_HOUR = Number(process.env.AGENT_OFFICIAL_PER_HOUR || 8);
const CREATOR_PER_HOUR = Number(process.env.AGENT_CREATOR_PER_HOUR || 3);
/** Coins older than this when the agent first sees them don't get a "just launched" post. */
const LAUNCH_WINDOW_MS = 6 * 60 * 60_000;
const HOUR = 60 * 60_000;

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

/** The next milestone to announce for a coin: the highest crossed step per family, launch first. */
function nextMilestone(t: Token, all: Milestone[], posted: AgentState["posted"][string], now: number): Milestone | null {
  if (!posted.launch && now - t.createdAt > LAUNCH_WINDOW_MS) posted.launch = { official: "skipped:old", creator: "skipped:old", at: now };
  const families = new Map<string, Milestone[]>();
  for (const m of all) families.set(m.family, [...(families.get(m.family) ?? []), m]);
  const order = ["launch", "graduated", "mc", "curve", "holders"];
  for (const fam of order) {
    const list = (families.get(fam) ?? []).sort((a, b) => b.rank - a.rank);
    const top = list[0];
    if (!top || posted[top.key]) continue;
    // Crossing several steps at once: announce only the highest; the rest are superseded.
    for (const lower of list.slice(1)) posted[lower.key] ??= { official: "superseded", creator: "superseded", at: now };
    return top;
  }
  return null;
}

async function publish(
  account: "official" | { wallet: string; username: string },
  t: Token,
  m: Milestone,
  posts: string[]
): Promise<string> {
  const label = account === "official" ? "@firepad (official)" : `@${account.username}`;
  const base = { at: Date.now(), mint: t.mint, symbol: t.symbol, milestone: m.key, account: label, posts };
  if (account === "official" && !officialEnabled()) {
    await appendOutbox({ ...base, result: "dry-run" });
    log(`DRY ${label} ${t.symbol} ${m.key}: ${posts[0].split("\n")[0]}`);
    return "dry";
  }
  try {
    const ids = account === "official" ? await postOfficial(posts) : await postAsCreator(account.wallet, posts);
    await appendOutbox({ ...base, result: "posted", ids });
    log(`POSTED ${label} ${t.symbol} ${m.key} → ${ids.join(",")}`);
    return ids[0];
  } catch (e) {
    const error = (e as Error).message;
    await appendOutbox({ ...base, result: "error", error });
    log(`ERROR ${label} ${t.symbol} ${m.key}: ${error}`);
    return `error: ${error}`;
  }
}

async function tick() {
  const [tokens, hidden, solUsd] = await Promise.all([listLiveTokens(), getHidden(), getSolUsd()]);
  const state = await loadAgentState();
  const now = Date.now();
  state.officialTimes = state.officialTimes.filter((x) => now - x < HOUR);
  for (const w of Object.keys(state.creatorTimes)) state.creatorTimes[w] = state.creatorTimes[w].filter((x) => now - x < HOUR);

  for (const t of [...tokens].sort((a, b) => a.createdAt - b.createdAt)) {
    if (hidden.has(t.mint)) continue;
    state.firstSeen[t.mint] ??= now;
    const facts = toFacts(t);
    const kit = await getKit(facts);
    const posted = (state.posted[t.mint] ??= {});
    const m = nextMilestone(t, milestonesFor(t, solUsd), posted, now);
    if (!m) continue;
    if (state.officialTimes.length >= OFFICIAL_PER_HOUR) {
      log(`official hourly limit reached; ${t.symbol} ${m.key} waits for the next tick`);
      continue;
    }

    // Official account.
    const officialText = await composePost(m, facts, "official");
    const official = await publish("official", t, m, [officialText]);
    state.officialTimes.push(now);

    // Creator's own account, if connected.
    let creator = "not-connected";
    const acct = creatorOAuthEnabled() ? await getXAccount(t.creator) : null;
    if (acct) {
      const times = (state.creatorTimes[t.creator] ??= []);
      if (times.length >= CREATOR_PER_HOUR) creator = "skipped:rate-limit";
      else {
        const posts = m.key === "launch" ? kit.thread : [await composePost(m, facts, "creator")];
        creator = await publish({ wallet: t.creator, username: acct.username }, t, m, posts);
        times.push(now);
      }
    }
    posted[m.key] = { official, creator, at: now };
    await saveAgentState(state);
  }
  await saveAgentState(state);
}

async function main() {
  log(
    `marketing agent · tick ${TICK_MS / 1000}s · writer: ${claudeEnabled() ? "Claude" : "templates"} · official X: ${
      officialEnabled() ? "live" : "dry run"
    } · creator X: ${creatorOAuthEnabled() ? "enabled" : "off"}`
  );
  for (;;) {
    const started = Date.now();
    await tick().catch((e) => console.error("tick failed:", e));
    await new Promise((r) => setTimeout(r, Math.max(5000, TICK_MS - (Date.now() - started))));
  }
}

main();
