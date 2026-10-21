import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { assertMainnetConnection, connection, MainnetRpcError } from "@/lib/server/connection";
import { buildConnectInstructions, packTransactions } from "@/lib/server/pump";
import { agentKey } from "@/lib/server/agent-key";
import { BodyError, clientIp, rateLimit, readJson } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { mint, wallet } → { transactions: base64[], lastValidBlockHeight }
 *
 * The transaction a coin's creator signs to split its creator fee 50/50 with
 * the FIREPAD payout wallet, permanently. Unsigned: only the creator's wallet can make it valid.
 */
export async function POST(req: Request) {
  let body;
  try {
    body = await readJson(req, 1_000);
  } catch (e) {
    if (e instanceof BodyError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  let mint: PublicKey, wallet: PublicKey;
  try {
    mint = new PublicKey(String(body.mint ?? ""));
    wallet = new PublicKey(String(body.wallet ?? ""));
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  if (!rateLimit(`connect:${clientIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many requests — try again later" }, { status: 429 });
  }
  const agent = agentKey();
  if (!agent) return NextResponse.json({ error: "The FIREPAD payout wallet isn't configured on this server" }, { status: 500 });

  try {
    await assertMainnetConnection();
    const built = await buildConnectInstructions(connection, mint, wallet, agent);
    if ("error" in built) return NextResponse.json({ error: built.error }, { status: 409 });
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const txs = packTransactions([built.instructions], wallet, blockhash, null, 400_000);
    return NextResponse.json({ transactions: txs.map((t) => Buffer.from(t.serialize()).toString("base64")), lastValidBlockHeight });
  } catch (e) {
    if (e instanceof MainnetRpcError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[connect/prepare]", e);
    return NextResponse.json({ error: "Couldn't build the transaction — try again shortly" }, { status: 503 });
  }
}
