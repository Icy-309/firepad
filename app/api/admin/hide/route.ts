import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/server/admin-route";
import { setHidden } from "@/lib/server/store";
import { readJson } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { mint, hidden } — hide/unhide a token from the public feed. */
export const POST = adminRoute(async (admin, req: Request) => {
  const { mint, hidden } = await readJson(req, 1024).catch(() => ({}) as Record<string, unknown>);
  if (typeof mint !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || typeof hidden !== "boolean") {
    return NextResponse.json({ error: "Expected { mint, hidden }" }, { status: 400 });
  }
  await setHidden(mint, hidden);
  console.info(`[admin] ${admin} ${hidden ? "hid" : "unhid"} ${mint}`);
  return NextResponse.json({ ok: true });
});
