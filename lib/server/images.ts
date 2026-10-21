import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "./store";

/** Coin images: content-addressed files in data/uploads, or pinned to IPFS. */

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const IMAGE_FILE_RE = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;

export const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} as const;
type Ext = keyof typeof IMAGE_TYPES;

export class ImageError extends Error {}

/** Identify the format from the file's magic bytes (never trust the declared type). */
export function sniffImage(b: Uint8Array): Ext | null {
  const ascii = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b.length > 8 && b[0] === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 6 && (ascii(0, "GIF87a") || ascii(0, "GIF89a"))) return "gif";
  if (b.length > 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  return null;
}

/**
 * Store an uploaded image and return its public URL. Pins to IPFS when PINATA_JWT
 * is set (survives this server going away); otherwise serves it from /api/image.
 */
export async function saveImage(bytes: Uint8Array, siteOrigin: string): Promise<string> {
  if (bytes.length === 0) throw new ImageError("Image is empty");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageError("Image is larger than 4 MB");
  const ext = sniffImage(bytes);
  if (!ext) throw new ImageError("Image must be a PNG, JPG, GIF or WEBP");
  const name = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;

  const jwt = process.env.PINATA_JWT;
  if (jwt) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: IMAGE_TYPES[ext] }), name);
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Pinata image upload failed: ${res.status}`);
    const { IpfsHash } = (await res.json()) as { IpfsHash: string };
    return `${process.env.IPFS_GATEWAY || "https://ipfs.io/ipfs"}/${IpfsHash}`;
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const file = path.join(UPLOAD_DIR, name);
  // Same bytes → same name, so re-uploads are free.
  await fs.access(file).catch(async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, file);
  });
  return `${siteOrigin.replace(/\/$/, "")}/api/image/${name}`;
}
