import { NextResponse } from "next/server";
import { finishConnect } from "@/lib/server/agent/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const origin = (req: Request) => (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, "");

/** X redirects here after the creator approves (or cancels) access. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const base = origin(req);
  const state = q.get("state") || "";
  const code = q.get("code");
  if (!code) return NextResponse.redirect(`${base}/?x=cancelled`);
  try {
    const { returnTo, username } = await finishConnect(state, code, base);
    const sep = returnTo.includes("?") ? "&" : "?";
    return NextResponse.redirect(`${base}${returnTo}${sep}x=connected&xuser=${encodeURIComponent(username)}`);
  } catch (e) {
    console.error("[x/callback]", e);
    return NextResponse.redirect(`${base}/?x=error`);
  }
}
