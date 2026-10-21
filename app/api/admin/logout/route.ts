import { NextResponse } from "next/server";
import { endAdminSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST() {
  endAdminSession();
  return NextResponse.json({ ok: true });
}
