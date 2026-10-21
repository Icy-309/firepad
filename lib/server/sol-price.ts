import { SOL_USD } from "@/lib/format";
import { processState } from "./process-state";

const TTL_MS = 60_000;
const cache = processState("solPrice", () => ({ usd: 0, at: 0, inflight: null as Promise<number> | null }));

async function fetchPrice(): Promise<number> {
  const sources: [string, (j: unknown) => unknown][] = [
    [
      "https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112",
      (j) => (j as Record<string, { usdPrice?: number }>)["So11111111111111111111111111111111111111112"]?.usdPrice,
    ],
    ["https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", (j) => (j as { solana?: { usd?: number } }).solana?.usd],
  ];
  for (const [url, pick] of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
      const v = Number(pick(await res.json()));
      if (Number.isFinite(v) && v > 0) return v;
    } catch {
      /* try the next source */
    }
  }
  throw new Error("no SOL price source answered");
}

/**
 * Live SOL/USD (Jupiter, then CoinGecko), cached for a minute. Market caps are shown
 * in USD like pump.fun, so this must track the real price. Falls back to the last
 * known price, then to the display constant, if every source is down.
 */
export async function getSolUsd(): Promise<number> {
  if (cache.usd && Date.now() - cache.at < TTL_MS) return cache.usd;
  cache.inflight ??= fetchPrice()
    .then((usd) => {
      cache.usd = usd;
      cache.at = Date.now();
      return usd;
    })
    .catch(() => cache.usd || SOL_USD)
    .finally(() => (cache.inflight = null));
  return cache.inflight;
}
