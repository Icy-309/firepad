import Link from "next/link";
import type { Token } from "@/lib/types";
import { fmtUsdCompact, shortAddr, timeAgo } from "@/lib/format";
import { CopyAddress } from "./CopyAddress";

/** Compact grid card (feed). */
export function TokenCard({ t, solUsd, delay = 0 }: { t: Token; solUsd: number; delay?: number }) {
  return (
    <Link
      href={`/token/${t.mint}`}
      className="spotlight reveal hover-lift group flex gap-3 rounded-2xl border border-line bg-panel/70 p-3 hover:border-brand/25 hover:bg-panel"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={t.image}
        alt=""
        className="h-24 w-24 shrink-0 rounded-xl border border-line bg-panel2 object-cover transition group-hover:scale-[1.02]"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-1.5">
          <h3 className="truncate font-semibold">{t.name}</h3>
          <span className="shrink-0 text-sm text-muted">{t.symbol}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          <span className="grid h-4 w-4 place-items-center rounded-full bg-gradient-to-br from-brand to-sol text-[8px] font-bold text-black">
            {t.creator[0]}
          </span>
          {shortAddr(t.creator)} · {timeAgo(t.createdAt)}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm font-semibold">
            <span className="text-muted">MC </span>
            {fmtUsdCompact(t.marketCapSol * solUsd)}
          </span>
          <Change v={t.change24h} />
        </div>

        <ProgressBar value={t.bondingProgress} complete={t.complete} className="mt-1.5" />

        <p className="mt-1.5 line-clamp-1 text-xs text-muted">{t.description}</p>
        <div className="mt-auto pt-1.5">
          <CopyAddress address={t.mint} className="!py-0.5" />
        </div>
      </div>
    </Link>
  );
}

/** Large card for the trending carousel. */
export function TrendingCard({
  t,
  solUsd,
  rank,
  delay = 0,
  hot = false,
}: {
  t: Token;
  solUsd: number;
  rank: number;
  delay?: number;
  hot?: boolean;
}) {
  return (
    <Link
      href={`/token/${t.mint}`}
      className={`${hot ? "fire-ring" : ""} spotlight reveal hover-lift group relative block w-[270px] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-panel hover:border-brand/40`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="relative h-36 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={t.image} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/20 to-transparent" />
        <span className={`absolute left-3 top-3 rounded-lg px-2 py-0.5 text-xs font-semibold backdrop-blur ${hot ? "bg-fire text-black" : "bg-black/60"}`}>
          {hot ? "HOT " : ""}#{rank}
        </span>
      </div>
      <div className="p-4 pt-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-semibold">{t.name}</h3>
          <Change v={t.change24h} />
        </div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">{t.symbol}</span>
          <span className="font-semibold">{fmtUsdCompact(t.marketCapSol * solUsd)}</span>
        </div>
        <ProgressBar value={t.bondingProgress} complete={t.complete} className="mt-2" />
      </div>
    </Link>
  );
}

export function Change({ v }: { v: number | null }) {
  if (v === null) return null;
  const up = v >= 0;
  return (
    <span className={`text-xs font-semibold ${up ? "text-up" : "text-down"}`}>
      {up ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}

export function ProgressBar({
  value,
  complete,
  className = "",
}: {
  value: number;
  complete?: boolean;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
        <div
          className={`h-full rounded-full ${complete ? "bg-sol" : "bar-heat bg-gradient-to-r from-brand to-sol"}`}
          style={{ width: `${complete ? 100 : pct}%` }}
        />
      </div>
      <span className="w-9 text-right text-[11px] font-medium text-muted">{complete ? "Done" : `${Math.round(pct)}%`}</span>
    </div>
  );
}
