import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/server/admin-route";
import { importVanityKeys, parseVanitySecret, type VanityKey } from "@/lib/server/store";
import { readJson } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { keys: number[][] } — solana-keygen JSON keypairs (64-byte arrays). */
export const POST = adminRoute(async (admin, req: Request) => {
  // 5000 keypairs as JSON byte arrays ≈ 1.3 MB.
  const { keys } = await readJson(req, 2_000_000).catch(() => ({}) as Record<string, unknown>);
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 5000) {
    return NextResponse.json({ error: "Expected { keys: number[][] } (1–5000 keypairs)" }, { status: 400 });
  }
  const valid: VanityKey[] = [];
  const rejected: string[] = [];
  keys.forEach((k: unknown, i: number) => {
    try {
      if (!Array.isArray(k) || !k.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error("not a byte array");
      valid.push(parseVanitySecret(Uint8Array.from(k as number[])));
    } catch (e) {
      rejected.push(`#${i + 1}: ${(e as Error).message}`);
    }
  });
  const added = valid.length ? await importVanityKeys(valid) : 0;
  console.info(`[admin] ${admin} imported ${added} vanity keys`);
  return NextResponse.json({ added, duplicates: valid.length - added, rejected });
});
