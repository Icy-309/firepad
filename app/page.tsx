import Link from "next/link";
import { TokenCard, TrendingCard } from "@/components/TokenCard";
import { Ticker } from "@/components/Ticker";
import { CountUp } from "@/components/CountUp";
import { Logo } from "@/components/Logo";
import { getSolUsd } from "@/lib/server/sol-price";
import { IconBolt, IconClock, IconGift, IconShield, IconTrend } from "@/components/Icons";
import { getHidden } from "@/lib/server/store";
import { listLiveTokens } from "@/lib/server/tokens";
import type { Token } from "@/lib/types";

// Reads pump.fun curves and the moderation list on every request.
export const dynamic = "force-dynamic";

const TABS = {
  trending: { label: "Trending", fn: (a: Token, b: Token) => (b.volume24hSol ?? b.raisedSol) - (a.volume24hSol ?? a.raisedSol) },
  new: { label: "New", fn: (a: Token, b: Token) => b.createdAt - a.createdAt },
  mcap: { label: "Market cap", fn: (a: Token, b: Token) => b.marketCapSol - a.marketCapSol },
  graduating: { label: "About to graduate", fn: (a: Token, b: Token) => b.bondingProgress - a.bondingProgress },
  graduated: { label: "Graduated", fn: (a: Token, b: Token) => b.marketCapSol - a.marketCapSol },
} as const;
type TabKey = keyof typeof TABS;

export default async function HomePage({ searchParams }: { searchParams: { tab?: string; q?: string } }) {
  const tab: TabKey = searchParams.tab && searchParams.tab in TABS ? (searchParams.tab as TabKey) : "trending";
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const [hidden, live, solUsd] = await Promise.all([getHidden(), listLiveTokens(), getSolUsd()]);
  const all = live.filter((t) => !hidden.has(t.mint));

  let tokens = all;
  if (q) {
    tokens = tokens.filter(
      (t) => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.mint.toLowerCase() === q
    );
  }
  if (tab === "graduating") tokens = tokens.filter((t) => !t.complete && t.bondingProgress >= 0.5);
  if (tab === "graduated") tokens = tokens.filter((t) => t.complete);
  tokens = [...tokens].sort(TABS[tab].fn);

  const trending = [...all].sort(TABS.trending.fn).slice(0, 8);
  const totalMcUsd = all.reduce((n, t) => n + t.marketCapSol * solUsd, 0);
  const holderPaidUsd = all.reduce((n, t) => n + t.holderFeesSol * solUsd, 0);

  return (
    <div className="space-y-10">
      {!q && (
        <>
          <div className="-mt-6">
            <Ticker tokens={trending} solUsd={solUsd} />
          </div>
        <section className="reveal relative overflow-hidden rounded-[28px] border border-line bg-panel shadow-pop">
          <div className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full bg-brand/[0.06] blur-3xl" />
          <div className="pointer-events-none absolute bottom-5 right-[36%] hidden opacity-[0.045] md:block">
            <Logo size={280} />
          </div>
          <div className="relative grid gap-10 p-6 sm:p-9 lg:grid-cols-[1.25fr_0.75fr] lg:items-center lg:p-12">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-ink/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-up" />
                Solana mainnet <span className="text-line">/</span> pump.fun
              </div>
              <h1 className="max-w-2xl font-display text-4xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-5xl lg:text-[58px]">
                Launch with purpose.
                <br />
                <span className="text-brand">Share creator fees.</span>
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-7 text-muted sm:text-base">
                A considered way to launch on pump.fun. Half of each creator fee goes to holders by balance; pump.fun
                locks the split on-chain. New launches get a <span className="font-mono text-white">...fire</span> address.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/create" className="btn-primary px-5 py-3">
                  Create a coin
                  <span aria-hidden="true">↗</span>
                  </Link>
                  <Link href="/create?mode=connect" className="btn-secondary px-5 py-3">
                  Connect an existing coin
                  </Link>
                </div>
              <dl className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-line pt-5">
                <HeroStat label="Coins listed">
                    <CountUp value={all.length} format="num" />
                  </HeroStat>
                <HeroStat label="Combined market cap">
                    <CountUp value={totalMcUsd} format="usd" />
                  </HeroStat>
                  <HeroStat label="Paid to holders">
                    <CountUp value={holderPaidUsd} format="usd" />
                  </HeroStat>
                </dl>
              </div>
            <div className="relative rounded-2xl border border-line bg-ink/75 p-5 sm:p-6">
              <div className="flex items-center justify-between border-b border-line pb-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Fee allocation</p>
                  <p className="mt-1 text-sm font-medium">Creator fees, shared by design</p>
                </div>
                <span className="rounded-full border border-brand/20 bg-brand/10 px-2.5 py-1 font-mono text-xs text-brand">
                  50 / 50
                </span>
              </div>
              <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-panel2">
                <div className="w-1/2 bg-brand" />
                <div className="w-1/2 bg-sol" />
              </div>
              <div className="mt-3 flex justify-between text-xs">
                <span className="text-muted">Creator <strong className="ml-1 text-white">50%</strong></span>
                <span className="text-muted">Holders <strong className="ml-1 text-white">50%</strong></span>
              </div>
              <div className="mt-6 space-y-1">
                <Feature icon={<IconShield className="h-4 w-4" />} title="Locked by pump.fun" body="The on-chain split cannot be changed." />
                <Feature icon={<IconGift className="h-4 w-4" />} title="Paid by token balance" body="Holder distributions are sent in SOL." />
                <Feature icon={<IconBolt className="h-4 w-4" />} title="Launch support included" body="Launch kits and milestone marketing." />
              </div>
            </div>
          </div>
        </section>

          {/* Trending carousel */}
          {trending.length > 0 && <section>
            <div className="mb-3 flex items-center gap-2">
              <IconTrend className="h-4 w-4 text-brand" />
              <h2 className="text-lg font-semibold tracking-tight">Trending now</h2>
            </div>
            <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
              {trending.map((t, i) => (
                <TrendingCard key={t.mint} t={t} solUsd={solUsd} rank={i + 1} delay={i * 60} hot={i === 0} />
              ))}
            </div>
          </section>}
        </>
      )}

      {/* Feed */}
      <section id="feed">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          {q ? (
            <h2 className="text-lg font-semibold">
              Results for &ldquo;{searchParams.q}&rdquo;{" "}
              <Link href="/" className="ml-2 text-sm font-normal text-muted hover:text-white">
                Clear
              </Link>
            </h2>
          ) : (
            <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
              {(Object.keys(TABS) as TabKey[]).map((k) => (
                <Link
                  key={k}
                  href={k === "trending" ? "/#feed" : `/?tab=${k}#feed`}
                  className={`tab whitespace-nowrap ${k === tab ? "tab-active" : ""}`}
                >
                  {k === "new" && <IconClock className="mr-1 inline h-4 w-4 align-[-3px]" />}
                  {TABS[k].label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {tokens.length === 0 ? (
          <div className="card flex flex-col items-center py-14 text-center">
            <p className="font-semibold">No coins here yet</p>
            <p className="mt-1 text-sm text-muted">Launch one, or connect a coin you already made on pump.fun.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link href="/create" className="btn-primary">
                Create a coin
              </Link>
              <Link href="/create?mode=connect" className="btn-secondary">
                Connect a coin
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {tokens.map((t, i) => (
              <TokenCard key={t.mint} t={t} solUsd={solUsd} delay={Math.min(i, 12) * 40} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function HeroStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted">{label}</dt>
      <dd className="mt-1 truncate font-mono text-lg font-semibold tracking-tight sm:text-xl">{children}</dd>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl px-2 py-3 transition hover:bg-panel">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-panel2 text-brand">{icon}</div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted">{body}</div>
      </div>
    </div>
  );
}
