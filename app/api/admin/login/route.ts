import { NextResponse } from "next/server";
import { adminWallets, AuthError, startAdminSession, verifySignedMessage } from "@/lib/server/auth";
import { BodyError, clientIp, rateLimit, readJson } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { wallet, message, signature } — message built with buildSignedMessage("admin-login"). */
export async function POST(req: Request) {
  if (!rateLimit(`admin-login:${clientIp(req)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
  }
  try {
    const wallet = verifySignedMessage("admin-login", await readJson(req), req);
    if (!adminWallets().has(wallet)) return NextResponse.json({ error: "This wallet is not an admin" }, { status: 403 });
    startAdminSession(wallet);
    return NextResponse.json({ admin: wallet });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof BodyError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[admin/login]", e);
    return NextResponse.json({ error: "Login failed — check the server logs" }, { status: 500 });
  }
}
