import { NextResponse } from "next/server";
import { getMetadata } from "@/lib/server/store";
import { metadataJson } from "@/lib/server/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Off-chain token metadata JSON (the `uri` stored in the mint's TokenMetadata). */
export async function GET(_req: Request, { params }: { params: { mint: string } }) {
  const m = await getMetadata(params.mint);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(metadataJson(m), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
