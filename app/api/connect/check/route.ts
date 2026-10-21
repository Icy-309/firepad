import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { assertMainnetConnection, connection, MainnetRpcError } from "@/lib/server/connection";
import { readSplit } from "@/lib/server/pump";
import { agentKey } from "@/lib/server/agent-key";
import { coinInfo } from "@/lib/server/coin-info";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?mint= → the coin's name/image and whether (and by whom) it can be connected. */
export async function GET(req: Request) {
  if (!rateLimit(`check:${clientIp(req)}`, 60, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many requests — try again in a few minutes" }, { status: 429 });
  }
  let mint: PublicKey;
  try {
    mint = new PublicKey(new URL(req.url).searchParams.get("mint") ?? "");
  } catch {
    return NextResponse.json({ error: "That isn't a valid contract address" }, { status: 400 });
  }
  const agent = agentKey();
  if (!agent) return NextResponse.json({ error: "The FIREPAD payout wallet isn't configured on this server" }, { status: 500 });
  try {
    await assertMainnetConnection();
    const split = await readSplit(connection, mint, agent);
    if (split.status === "not-pump") return NextResponse.json({ split });
    const info = await coinInfo(mint.toBase58(), "creator" in split ? split.creator : undefined);
    return NextResponse.json({ split, info });
  } catch (e) {
    if (e instanceof MainnetRpcError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[connect/check]", e);
    return NextResponse.json({ error: "Couldn't reach Solana — try again shortly" }, { status: 503 });
  }
}
