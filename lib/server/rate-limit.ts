/**
 * In-process sliding-window rate limits. Fine for a single long-running server;
 * move to Redis when running more than one instance.
 */

import { processState } from "./process-state";

const hits = processState("rateLimitHits", () => new Map<string, number[]>());
const sweep = processState("rateLimitSweep", () => ({ last: 0 }));

/** Record a hit for `key`; false if it already had `limit` hits within `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - sweep.last > 60_000) {
    sweep.last = now;
    for (const [k, ts] of hits) if (!ts.length || now - ts[ts.length - 1] > 60 * 60_000) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/**
 * Best-effort client IP. Uses the right-most X-Forwarded-For entry (the one added
 * by the closest proxy — `next start` or your reverse proxy), which a client can't
 * forge by sending its own header. Behind several proxies, set TRUSTED_PROXY_HOPS.
 */
export function clientIp(req: Request): string {
  const xff = (req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS || 1));
  return xff[xff.length - hops] || req.headers.get("x-real-ip") || "unknown";
}

/** Parse a JSON body, refusing anything over `maxBytes`. */
export async function readJson(req: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new BodyError("Request body too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new BodyError("Request body too large");
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new BodyError("Invalid JSON");
  }
}

export class BodyError extends Error {}
