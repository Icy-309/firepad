import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtNum, fmtPrice, fmtSol, fmtUsdCompact, shortAddr, timeAgo } from "@/lib/format";
import { getSolUsd } from "@/lib/server/sol-price";
import { INITIAL_CURVE, marketCapSol } from "@/lib/curve";
import { explorerAddress, explorerTx } from "@/lib/rpc";
import { getLiveToken } from "@/lib/server/tokens";
import { getCoin } from "@/lib/server/fireagent-store";
import { pumpUrl } from "@/lib/server/pump";
import { getHidden } from "@/lib/server/store";
import { LaunchKit } from "@/components/LaunchKit";
import { CopyAddress } from "@/components/CopyAddress";
import { ProgressBar } from "@/components/TokenCard";
import { IconExternal, IconGlobe, IconTelegram, IconX_Social } from "@/components/Icons";

// Reads the pump.fun curve and the agent's payout record per request.
export const dynamic = "force-dynamic";

export default async function TokenPage({ params }: { params: { mint: string } }) {
  const [t, coin, hidden, solUsd] = await Promise.all([
    getLiveToken(params.mint),
    getCoin(params.mint),
    getHidden(),
    getSolUsd(),
  ]);
  if (!t || !coin) notFound();
  const payouts = coin.payouts.slice(0, 10);

  return (
    <div className="space-y-5">
      <Link href="/" className="inline-block text-sm text-muted hover:text-white">
        ← Back
      </Link>

      {hidden.has(t.mint) && (
        <div className="rounded-xl border border-down/50 bg-down/10 p-3 text-sm text-down">
          Moderators hid this coin from the feed. Trade with caution.
        </div>
      )}
      {coin.inactive && (
        <div className="rounded-xl border border-down/50 bg-down/10 p-3 text-sm text-down">
          This coin&apos;s fees no longer reach the FIREPAD payout wallet, so holders aren&apos;t being paid. {coin.inactive}
        </div>
      )}

      {/* Header */}
      <section className="reveal card p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={t.image} alt="" className="h-16 w-16 rounded-2xl bg-panel2 object-cover sm:h-20 sm:w-20" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">{t.name}</h1>
              <span className="text-lg text-muted">{t.symbol}</span>
              {t.complete && (
                <span className="rounded-md bg-sol/15 px-1.5 py-0.5 text-xs font-semibold text-sol">Graduated</span>
              )}
            </div>
            <div className="mt-1 text-sm text-muted">
              Created by <span className="font-mono text-white">{shortAddr(t.creator)}</span> ·{" "}
              {t.source === "launch" ? "launched here" : "connected"} {timeAgo(t.createdAt)}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <CopyAddress address={t.mint} full />
              {t.website && (
                <SocialLink href={t.website} label="Website">
                  <IconGlobe className="h-3.5 w-3.5" />
                </SocialLink>
              )}
              {t.twitter && (
                <SocialLink href={t.twitter} label="X">
                  <IconX_Social className="h-3 w-3" />
                </SocialLink>
              )}
              {t.telegram && (
                <SocialLink href={t.telegram} label="Telegram">
                  <IconTelegram className="h-3.5 w-3.5" />
                </SocialLink>
              )}
              <a
                href={explorerAddress(t.mint)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-white"
              >
                Explorer <IconExternal className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5">
          <Stat label="Price" value={`${fmtPrice(t.priceSol)} SOL`} />
          <Stat label="Market cap" value={fmtUsdCompact(t.marketCapSol * solUsd)} />
          <Stat label="Holders" value={t.holders === null ? "—" : fmtNum(t.holders)} />
          <Stat label="Paid to holders" value={`${fmtSol(t.holderFeesSol, 3)} SOL`} />
          <Stat label="Next payout pool" value={`${fmtSol(t.holderPoolSol, 3)} SOL`} />
        </div>
      </section>

      <div className="reveal grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]" style={{ animationDelay: "80ms" }}>
        {/* Left */}
        <div className="min-w-0 space-y-5">
          {t.description && (
            <section className="card p-4">
              <h2 className="text-sm font-semibold">About</h2>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted">{t.description}</p>
            </section>
          )}

          <LaunchKit
            mint={t.mint}
            name={t.name}
            symbol={t.symbol}
            image={t.image}
            creator={t.creator}
            mcUsd={t.marketCapSol * solUsd}
            launchMcUsd={marketCapSol(INITIAL_CURVE) * solUsd}
          />

          <section className="card overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Holder payouts</h2>
              {coin.lastPayoutAt && <span className="text-xs text-muted">Last {timeAgo(coin.lastPayoutAt)}</span>}
            </div>
            {payouts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                No payouts yet. Holders get paid once enough creator fees have built up.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {payouts.map((p) => (
                  <div key={p.at} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="text-muted">{timeAgo(p.at)}</span>
                    <span>
                      <span className="font-semibold text-sol">{fmtSol(p.lamports / 1e9, 4)} SOL</span>
                      <span className="text-muted"> to {fmtNum(p.recipients)} {p.recipients === 1 ? "holder" : "holders"}</span>
                    </span>
                    {p.signatures[0] && (
                      <a
                        href={explorerTx(p.signatures[0])}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-white"
                      >
                        {p.signatures.length > 1 ? `${p.signatures.length} txs` : "Tx"} <IconExternal className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right */}
        <div className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Trade</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {t.symbol} trades on pump.fun{t.complete ? " and PumpSwap" : ""}. Every trade pays its creator fee, and half of
              half of creator fees is returned to holders through FIREPAD.
            </p>
            <a href={pumpUrl(t.mint)} target="_blank" rel="noreferrer" className="btn-primary mt-3 w-full py-3">
              Trade on pump.fun <IconExternal className="h-4 w-4" />
            </a>
          </section>

          <section className="card p-4">
            <h2 className="text-sm font-semibold">Creator fee split</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-line">
              <div className="flex h-8 text-xs font-semibold">
                <div className="flex w-1/2 items-center justify-center bg-brand text-white">Creator 50%</div>
                <div className="flex w-1/2 items-center justify-center bg-sol text-black">Holders 50%</div>
              </div>
            </div>
            <dl className="mt-3 space-y-1.5 text-xs">
              <Row label="Creator fees distributed">{fmtSol(t.feesCollectedSol, 4)} SOL</Row>
              <Row label="Paid to holders">{fmtSol(t.holderFeesSol, 4)} SOL</Row>
              <Row label="Waiting for next payout">{fmtSol(t.holderPoolSol, 4)} SOL</Row>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              pump.fun pays the creator&apos;s half directly. The other half is paid out to holders in SOL, by how much they
              hold. pump.fun locks the split, so nobody can change it.
            </p>
          </section>

          <section className="card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Bonding curve</h2>
              <span className="text-xs text-muted">{fmtSol(t.raisedSol, 2)} / ~85 SOL</span>
            </div>
            <ProgressBar value={t.bondingProgress} complete={t.complete} className="mt-3" />
            <p className="mt-2.5 text-xs leading-relaxed text-muted">
              {t.complete
                ? "This coin sold out its curve and trades on PumpSwap. Holders keep earning from its creator fee."
                : "When the curve sells out, the coin moves to PumpSwap. Holders keep earning from its creator fee."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink/60 px-2 py-1 text-xs text-muted transition hover:border-brand/50 hover:text-white"
    >
      {children}
      {label}
    </a>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-panel px-3.5 py-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold text-white">{children}</dd>
    </div>
  );
}
