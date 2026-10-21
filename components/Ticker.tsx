import Link from "next/link";
import type { Token } from "@/lib/types";
import { fmtUsdCompact } from "@/lib/format";

/** Scrolling tape of coins (pauses on hover). The list is doubled for a seamless loop. */
export function Ticker({ tokens, solUsd }: { tokens: Token[]; solUsd: number }) {
  if (!tokens.length) return null;
  const items = [...tokens, ...tokens];
  return (
    <div className="ticker -mx-4 overflow-hidden border-y border-line bg-panel/60 py-2 lg:-mx-6">
      <div className="ticker-track flex w-max animate-marquee gap-8 pl-8">
        {items.map((t, i) => {
          return (
            <Link
              key={`${t.mint}-${i}`}
              href={`/token/${t.mint}`}
              className="flex shrink-0 items-center gap-2 text-sm text-muted transition hover:text-white"
              aria-hidden={i >= tokens.length}
              tabIndex={i >= tokens.length ? -1 : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.image} alt="" className="h-5 w-5 rounded-full object-cover" />
              <span className="font-semibold text-white">{t.symbol}</span>
              <span>{fmtUsdCompact(t.marketCapSol * solUsd)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
