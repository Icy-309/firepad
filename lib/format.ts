export function fmtSol(n: number, dp = 3): string {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return n.toFixed(dp);
}

export function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

export function shortAddr(a: string): string {
  return a.length <= 10 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Fallback SOL/USD, used only if every live price source is down (see lib/server/sol-price.ts). */
export const SOL_USD = 120;

/** Tiny SOL prices, e.g. 0.00000002796 → "0.0₇2796" (subscript = zeros after the point). */
export function fmtPrice(n: number): string {
  if (n <= 0) return "0";
  if (n >= 0.001) return n.toFixed(6);
  const zeros = Math.ceil(-Math.log10(n)) - 1; // zeros between the decimal point and first digit
  const sub = String(zeros).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[+d]);
  const digits = Math.round(n * 10 ** (zeros + 4)).toString().slice(0, 4).replace(/0+$/, "");
  return `0.0${sub}${digits || "0"}`;
}

/** Compact USD, e.g. 12_300 → "$12.3K". */
export function fmtUsdCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
