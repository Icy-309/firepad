import { NextResponse } from "next/server";
import { issueNonce } from "@/lib/server/auth";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → { nonce } — single use, valid for 5 minutes. */
export async function GET(req: Request) {
  if (!rateLimit(`nonce:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down" }, { status: 429 });
  }
  return NextResponse.json({ nonce: issueNonce() }, { headers: { "Cache-Control": "no-store" } });
}
