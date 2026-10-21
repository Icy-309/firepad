import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { assertMainnetConnection, connection, MainnetRpcError } from "@/lib/server/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * JSON-RPC proxy for the browser. The page talks to /api/rpc, the server forwards to
 * RPC_URL (Helius), so the API key never reaches the client and the browser isn't stuck
 * on the rate-limited public endpoint. Only methods the app actually uses are allowed.
 */
const ALLOWED = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);
const MAX_BODY = 256 * 1024;
const MAX_BATCH = 20;

export async function POST(req: Request) {
  const upstream = connection.rpcEndpoint;
  if (!rateLimit(`rpc:${clientIp(req)}`, 600, 60_000)) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: 429, message: "Too many requests" } }, { status: 429 });
  }
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return NextResponse.json({ error: "Bad batch size" }, { status: 400 });
  for (const c of calls) {
    const method = (c as { method?: unknown })?.method;
    if (typeof method !== "string" || !ALLOWED.has(method)) {
      return NextResponse.json(
        { jsonrpc: "2.0", id: (c as { id?: unknown })?.id ?? null, error: { code: -32601, message: `Method not allowed: ${String(method)}` } },
        { status: 403 }
      );
    }
  }
  try {
    await assertMainnetConnection();
  } catch (error) {
    if (error instanceof MainnetRpcError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
  const res = await fetch(upstream, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
    signal: AbortSignal.timeout(30_000),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
