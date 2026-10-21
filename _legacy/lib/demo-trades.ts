/**
 * Synthetic trade history for the demo coins (lib/mock.ts) so their charts look like a
 * real market. Deterministic per mint, so server and client agree. Live coins never use this.
 */
export interface ChartTrade {
  id: string;
  side: "buy" | "sell" | "fee";
  sol: number;
  at: number; // ms
  mcBefore: number; // USD
  mcAfter: number; // USD
}

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A Brownian bridge in log-market-cap from the launch cap to today's cap. */
export function demoHistory(mint: string, launchMc: number, nowMc: number, from: number, to: number, n = 240): ChartTrade[] {
  const r = rng(mint);
  const times = Array.from({ length: n }, () => from + r() * (to - from)).sort((a, b) => a - b);
  const steps = Array.from({ length: n }, () => (r() - 0.47) * 0.09);
  const total = steps.reduce((a, b) => a + b, 0);
  const a = Math.log(launchMc);
  const b = Math.log(Math.max(nowMc, launchMc * 0.5));
  const out: ChartTrade[] = [];
  let walk = 0;
  let prev = launchMc;
  for (let i = 0; i < n; i++) {
    walk += steps[i];
    const p = (i + 1) / n;
    const mc = Math.exp(a + (b - a) * p + walk - total * p);
    out.push({
      id: `demo-${mint}-${i}`,
      side: mc >= prev ? "buy" : "sell",
      sol: Math.max(0.01, (Math.abs(mc - prev) / Math.max(prev, 1)) * 30 * (0.6 + r())),
      at: times[i],
      mcBefore: prev,
      mcAfter: mc,
    });
    prev = mc;
  }
  return out;
}

/** One more simulated trade for a demo coin's live feed. */
export function demoNext(prev: ChartTrade, launchMc: number): ChartTrade {
  const buy = Math.random() < 0.56;
  const sol = +(0.02 + Math.random() ** 2 * 2.5).toFixed(3);
  const move = (sol / 30) * (buy ? 1 : -1);
  const mc = Math.max(launchMc * 0.8, prev.mcAfter * (1 + move));
  return { id: `demo-live-${Date.now()}-${Math.random()}`, side: buy ? "buy" : "sell", sol, at: Date.now(), mcBefore: prev.mcAfter, mcAfter: mc };
}
