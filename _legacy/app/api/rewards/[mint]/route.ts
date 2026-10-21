import { NextResponse } from "next/server";
import { loadRewards } from "@/lib/server/rewards-store";
import { buildTree, proofFor, toHex, type RewardsTree } from "@/lib/merkle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rebuilding a tree is cheap but not free; keep the latest one per mint.
const cache = new Map<string, { root: string; tree: RewardsTree }>();

/**
 * GET /api/rewards/<mint>?wallet=<address>
 * → { epoch, root, cumulative, proof[] } — the wallet's cumulative allocation in the
 *   latest on-chain root, with the proof `claim_rewards` needs. cumulative "0" if none.
 */
export async function GET(req: Request, { params }: { params: { mint: string } }) {
  const wallet = new URL(req.url).searchParams.get("wallet") || "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return NextResponse.json({ error: "wallet query param required" }, { status: 400 });
  }
  let state;
  try {
    state = await loadRewards(params.mint);
  } catch {
    return NextResponse.json({ error: "bad mint" }, { status: 400 });
  }
  const base = { epoch: state.epoch, root: state.root, holders: state.holders, nextEpochAt: state.lastEpochAt };
  const amount = state.allocations[wallet];
  if (!state.root || !amount) return NextResponse.json({ ...base, cumulative: "0", proof: [] });

  let cached = cache.get(params.mint);
  if (!cached || cached.root !== state.root) {
    const tree = buildTree(Object.fromEntries(Object.entries(state.allocations).map(([w, a]) => [w, BigInt(a)])));
    if (!tree || toHex(tree.root) !== state.root) {
      return NextResponse.json({ error: "rewards data out of sync — try again shortly" }, { status: 503 });
    }
    cached = { root: state.root, tree };
    cache.set(params.mint, cached);
  }
  const proof = proofFor(cached.tree, wallet) ?? [];
  return NextResponse.json({ ...base, cumulative: amount, proof: proof.map(toHex) });
}
