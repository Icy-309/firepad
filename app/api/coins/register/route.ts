import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { assertMainnetConnection, connection, MainnetRpcError } from "@/lib/server/connection";
import { readSplit } from "@/lib/server/pump";
import { agentKey } from "@/lib/server/agent-key";
import { coinInfo } from "@/lib/server/coin-info";
import { getCoin, registerCoin } from "@/lib/server/fireagent-store";
import { getMetadata } from "@/lib/server/store";
import { BodyError, clientIp, rateLimit, readJson } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { mint } → { coin }
 *
 * Adds a coin to FIREPAD once its creator fee is split 50/50 with the payout wallet on
 * chain. Needs no signature: the on-chain split is the proof, and only the coin's
 * creator could have set it.
 */
export async function POST(req: Request) {
  let body;
  try {
    body = await readJson(req, 1_000);
  } catch (e) {
    if (e instanceof BodyError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  let mint: PublicKey;
  try {
    mint = new PublicKey(String(body.mint ?? ""));
  } catch {
    return NextResponse.json({ error: "That isn't a valid contract address" }, { status: 400 });
  }
  const existing = await getCoin(mint.toBase58());
  if (existing) return NextResponse.json({ coin: existing });

  if (!rateLimit(`register:${clientIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many requests — try again later" }, { status: 429 });
  }
  const agent = agentKey();
  if (!agent) return NextResponse.json({ error: "The FIREPAD payout wallet isn't configured on this server" }, { status: 500 });

  try {
    await assertMainnetConnection();
    const split = await readSplit(connection, mint, agent);
    if (split.status !== "active") {
      return NextResponse.json({ error: "This coin's fees aren't split with the FIREPAD payout wallet yet" }, { status: 409 });
    }
    const info = await coinInfo(mint.toBase58(), split.creator);
    const launchedHere = (await getMetadata(mint.toBase58()))?.creator === split.creator;
    const coin = await registerCoin({
      mint: mint.toBase58(),
      creator: split.creator,
      name: info?.name || "Unknown",
      symbol: info?.symbol || "",
      description: info?.description || "",
      image: info?.image || "",
      website: info?.website,
      twitter: info?.twitter,
      telegram: info?.telegram,
      source: launchedHere ? "launch" : "connect",
    });
    return NextResponse.json({ coin });
  } catch (e) {
    if (e instanceof MainnetRpcError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[coins/register]", e);
    return NextResponse.json({ error: "Couldn't reach Solana — try again shortly" }, { status: 503 });
  }
}
