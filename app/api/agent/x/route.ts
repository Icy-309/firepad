import { NextResponse } from "next/server";
import { AuthError, verifySignedMessage } from "@/lib/server/auth";
import { BodyError, clientIp, rateLimit, readJson } from "@/lib/server/rate-limit";
import { creatorOAuthEnabled, getXAccount, removeXAccount, startConnect } from "@/lib/server/agent/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const origin = (req: Request) => (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, "");

/** GET /api/agent/x?wallet=… → whether creator posting is enabled and this wallet's linked X. */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet") || "";
  if (!WALLET_RE.test(wallet)) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  const a = creatorOAuthEnabled() ? await getXAccount(wallet).catch(() => null) : null;
  return NextResponse.json({ enabled: creatorOAuthEnabled(), connected: !!a, username: a?.username ?? null });
}

/**
 * POST { action: "connect" | "disconnect", wallet, message, signature, returnTo? }
 * The wallet signs, so only the owner can link (or unlink) an X account to it.
 */
export async function POST(req: Request) {
  if (!rateLimit(`xconnect:${clientIp(req)}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many requests — try again later" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (e) {
    return NextResponse.json({ error: e instanceof BodyError ? e.message : "Invalid request" }, { status: 400 });
  }
  const action = body.action === "disconnect" ? "x-disconnect" : "x-connect";
  let wallet: string;
  try {
    wallet = verifySignedMessage(action, body, req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }
  if (action === "x-disconnect") {
    await removeXAccount(wallet);
    return NextResponse.json({ ok: true });
  }
  if (!creatorOAuthEnabled()) {
    return NextResponse.json({ error: "Connecting X isn't set up on this server yet" }, { status: 503 });
  }
  const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/") ? body.returnTo : "/";
  return NextResponse.json({ url: startConnect(wallet, origin(req), returnTo) });
}
