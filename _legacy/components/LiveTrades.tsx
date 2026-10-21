"use client";

import { useEffect, useRef, useState } from "react";
import type { Trade } from "@/lib/types";
import { fmtNum, fmtSol, shortAddr, timeAgo } from "@/lib/format";
import { explorerTx } from "@/lib/rpc";

const COLS = "grid grid-cols-[64px_1fr_1fr_72px] gap-2 sm:grid-cols-[64px_1fr_1fr_1fr_72px]";
const POLL_MS = 5000;

interface ApiTrade {
  id: string;
  sig: string;
  side: "buy" | "sell" | "fee";
  wallet: string;
  sol: number;
  tokens: number;
  at: number;
}

/**
 * Recent trades for a live coin, from /api/trades (server-side, cached, via the
 * server's RPC), so the browser doesn't hammer the RPC itself. New trades slide in.
 */
export function LiveTrades({ mint, symbol }: { mint: string; symbol: string }) {
  const [trades, setTrades] = useState<(Trade & { sig: string })[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    let stop = false;
    known.current = null;
    const load = async () => {
      try {
        const res = await fetch(`/api/trades/${mint}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (stop) return;
        const list = (body.trades as ApiTrade[])
          .filter((t) => t.side !== "fee")
          .reverse()
          .slice(0, 50)
          .map((t) => ({ id: t.id, sig: t.sig, side: t.side as "buy" | "sell", wallet: t.wallet, amountSol: t.sol, tokens: t.tokens, at: t.at }));
        // Highlight rows we haven't shown before (not on the first load).
        if (known.current) {
          const added = new Set(list.filter((t) => !known.current!.has(t.id)).map((t) => t.id));
          if (added.size) setFresh(added);
        }
        known.current = new Set(list.map((t) => t.id));
        setTrades(list);
        setError(false);
      } catch {
        if (!stop) setError(true);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [mint]);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-semibold">Trades</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-sol" /> Live
        </span>
      </div>
      <TradeHeader />
      {error && trades === null && <p className="px-4 py-8 text-center text-sm text-down">Couldn&apos;t load trades. Retrying…</p>}
      {!error && trades === null && <p className="px-4 py-8 text-center text-sm text-muted">Loading trades…</p>}
      {trades?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No trades yet. Be the first.</p>}
      <div className="divide-y divide-line">
        {trades?.map((tr) => (
          <TradeRow key={tr.id} tr={tr} symbol={symbol} href={explorerTx(tr.sig)} fresh={fresh.has(tr.id)} />
        ))}
      </div>
    </section>
  );
}

export function TradeHeader() {
  return (
    <div className={`${COLS} border-b border-line px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted`}>
      <span>Type</span>
      <span>Account</span>
      <span className="text-right">SOL</span>
      <span className="hidden text-right sm:block">Amount</span>
      <span className="text-right">Time</span>
    </div>
  );
}

export function TradeRow({ tr, symbol, href, fresh }: { tr: Trade; symbol: string; href?: string; fresh?: boolean }) {
  const body = (
    <>
      <span className={`font-semibold ${tr.side === "buy" ? "text-up" : "text-down"}`}>{tr.side === "buy" ? "Buy" : "Sell"}</span>
      <span className="truncate font-mono text-muted">{shortAddr(tr.wallet)}</span>
      <span className="text-right">{fmtSol(tr.amountSol)}</span>
      <span className="hidden truncate text-right text-muted sm:block">
        {fmtNum(Math.round(tr.tokens))} {symbol}
      </span>
      <span className="text-right text-xs text-muted" suppressHydrationWarning>
        {timeAgo(tr.at)}
      </span>
    </>
  );
  const cls = `${COLS} items-center px-4 py-2.5 text-sm ${fresh ? (tr.side === "buy" ? "row-in-buy" : "row-in-sell") : ""}`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:bg-panel2/50`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
