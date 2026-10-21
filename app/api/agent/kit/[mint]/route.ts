import { NextResponse } from "next/server";
import { getLiveToken } from "@/lib/server/tokens";
import { getKit, loadKit } from "@/lib/server/agent/kit";
import { toFacts } from "@/lib/server/agent/facts";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agent/kit/<mint> → the coin's Launch Kit (generated on first request, then cached). */
export async function GET(req: Request, { params }: { params: { mint: string } }) {
  const cached = await loadKit(params.mint).catch(() => null);
  if (cached) return NextResponse.json(cached);
  // Generating can call Claude, so cap how often one client can trigger it.
  if (!rateLimit(`kit:${clientIp(req)}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many requests — try again later" }, { status: 429 });
  }
  const t = await getLiveToken(params.mint);
  if (!t) return NextResponse.json({ error: "Coin not found" }, { status: 404 });
  return NextResponse.json(await getKit(toFacts(t)));
}
