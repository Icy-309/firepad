import { promises as fs } from "fs";
import path from "path";
import { IMAGE_FILE_RE, IMAGE_TYPES, UPLOAD_DIR } from "@/lib/server/images";

export const runtime = "nodejs";

/** GET /api/image/<sha256>.<ext> — coin images uploaded at launch. */
export async function GET(_req: Request, { params }: { params: { file: string } }) {
  // Strict name check: this is also what keeps the path inside UPLOAD_DIR.
  if (!IMAGE_FILE_RE.test(params.file)) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path.join(UPLOAD_DIR, params.file));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const ext = params.file.split(".")[1] as keyof typeof IMAGE_TYPES;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": IMAGE_TYPES[ext],
      // Content-addressed: the bytes behind a name never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
