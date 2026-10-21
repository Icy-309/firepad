"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { fmtUsdCompact } from "@/lib/format";
import { demoHistory, demoNext, type ChartTrade } from "@/lib/demo-trades";

const FRAMES = { "5m": 300, "1h": 3600, "4h": 14400 } as const;
type Frame = keyof typeof FRAMES;
const POLL_MS = 4000;
/** Pixels per candle (body is ~80% of this). */
const BAR_SPACING = 7;

interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

// lightweight-charts renders UTC; shift timestamps so the axis shows local time.
const tzShift = () => -new Date().getTimezoneOffset() * 60;

function toCandles(trades: ChartTrade[], interval: number): Candle[] {
  const out: Candle[] = [];
  const shift = tzShift();
  let cur: Candle | null = null;
  for (const t of trades) {
    const time = (Math.floor(t.at / 1000 / interval) * interval + shift) as UTCTimestamp;
    if (!cur || cur.time !== time) {
      if (cur) out.push(cur);
      const open: number = cur ? cur.close : t.mcBefore; // continuous candles, like pump.fun
      cur = { time, open, high: Math.max(open, t.mcAfter), low: Math.min(open, t.mcAfter), close: t.mcAfter };
    } else {
      cur.high = Math.max(cur.high, t.mcAfter);
      cur.low = Math.min(cur.low, t.mcAfter);
      cur.close = t.mcAfter;
    }
  }
  if (cur) out.push(cur);
  return out;
}

interface Bubble {
  id: string;
  x: number;
  y: number;
  side: "buy" | "sell";
  sol: number;
}

/**
 * Market-cap candles (USD) built from real on-chain trades (/api/trades), with 5m / 1h / 4h
 * candles. New buys and sells pop onto the chart as they land.
 */
export function PriceChart({
  mint,
  live,
  mcUsd,
  launchMcUsd,
  createdAt,
}: {
  mint: string;
  live: boolean;
  mcUsd: number;
  launchMcUsd: number;
  createdAt: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const [frame, setFrame] = useState<Frame>("5m");
  const [trades, setTrades] = useState<ChartTrade[] | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [error, setError] = useState(false);
  const pending = useRef<ChartTrade[]>([]);
  // Read by the data effect without re-running it: a page refresh after a trade
  // changes mcUsd, and that must not reload the chart (and skip the trade's animation).
  const params = useRef({ mcUsd, launchMcUsd, createdAt });
  params.current = { mcUsd, launchMcUsd, createdAt };

  // ---- data: real trades (live coins) or a simulated market (demo coins)
  const accept = useCallback((incoming: ChartTrade[], initial: boolean) => {
    const fresh = incoming.filter((t) => !seen.current.has(t.id));
    if (!fresh.length) return;
    fresh.forEach((t) => seen.current.add(t.id));
    setTrades((prev) => [...(prev ?? []), ...fresh].sort((a, b) => a.at - b.at));
    if (!initial) pending.current.push(...fresh.filter((t) => t.side !== "fee"));
  }, []);

  useEffect(() => {
    seen.current = new Set();
    setTrades(null);
    if (!live) {
      const { mcUsd, launchMcUsd, createdAt } = params.current;
      const hist = demoHistory(mint, launchMcUsd, mcUsd, createdAt, Date.now());
      accept(hist, true);
      let last = hist[hist.length - 1];
      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        last = demoNext(last, launchMcUsd);
        accept([last], false);
        timer = setTimeout(tick, 2500 + Math.random() * 4000);
      };
      timer = setTimeout(tick, 2000);
      return () => clearTimeout(timer);
    }
    let stop = false;
    let first = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/trades/${mint}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (!stop) {
          accept(body.trades, first);
          if (first) setTrades((t) => t ?? []);
          first = false;
          setError(false);
        }
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
  }, [mint, live, accept]);

  // ---- chart setup (once)
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8b8b9e", fontFamily: "inherit" },
      grid: { vertLines: { color: "#191921" }, horzLines: { color: "#191921" } },
      rightPriceScale: { borderColor: "#24242f", scaleMargins: { top: 0.15, bottom: 0.1 } },
      // Fixed, narrow spacing (pump.fun-like): a new coin's few candles stay thin instead of
      // being stretched across the whole width.
      timeScale: { borderColor: "#24242f", timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: BAR_SPACING, minBarSpacing: 2 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const s = c.addSeries(CandlestickSeries, {
      upColor: "#14F195",
      downColor: "#FF4D6A",
      borderVisible: false,
      wickUpColor: "#14F195",
      wickDownColor: "#FF4D6A",
      priceFormat: { type: "custom", formatter: (p: number) => fmtUsdCompact(p), minMove: 0.01 },
    });
    chart.current = c;
    series.current = s;
    markers.current = createSeriesMarkers(s, []);
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      markers.current = null;
    };
  }, []);

  const interval = FRAMES[frame];
  const candles = useMemo(() => (trades ? toCandles(trades, interval) : []), [trades, interval]);

  // Refit when the timeframe changes or the first data arrives.
  const fitted = useRef<string>("");
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.setData(candles);
    // One marker per candle (its biggest trade) over the most recent candles.
    if (trades) {
      const shift = tzShift();
      const best = new Map<number, ChartTrade>();
      for (const t of trades) {
        if (t.side === "fee") continue;
        const time = Math.floor(t.at / 1000 / interval) * interval + shift;
        const b = best.get(time);
        if (!b || t.sol > b.sol) best.set(time, t);
      }
      const list: SeriesMarker<Time>[] = [...best.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(-60)
        .map(([time, t]) => ({
          time: time as UTCTimestamp,
          position: t.side === "buy" ? "belowBar" : "aboveBar",
          shape: t.side === "buy" ? "arrowUp" : "arrowDown",
          color: t.side === "buy" ? "#14F195" : "#FF4D6A",
          size: 0.6,
        }));
      markers.current?.setMarkers(list);
    }
    const key = `${frame}:${trades ? "data" : "none"}`;
    if (fitted.current !== key && candles.length) {
      fitted.current = key;
      const ts = chart.current?.timeScale();
      ts?.applyOptions({ barSpacing: BAR_SPACING });
      ts?.scrollToRealTime();
    }

    // Pop the trades that just landed onto the chart.
    const landed = pending.current.splice(0);
    if (!landed.length || !chart.current) return;
    const shift = tzShift();
    const next: Bubble[] = [];
    for (const t of landed.slice(-4)) {
      const time = (Math.floor(t.at / 1000 / interval) * interval + shift) as UTCTimestamp;
      const x = chart.current.timeScale().timeToCoordinate(time);
      const y = s.priceToCoordinate(t.mcAfter);
      if (x === null || y === null) continue;
      next.push({ id: t.id, x, y, side: t.side as "buy" | "sell", sol: t.sol });
    }
    if (next.length) {
      setBubbles((b) => [...b, ...next].slice(-8));
      const lastT = landed[landed.length - 1];
      setFlash(lastT.mcAfter >= lastT.mcBefore ? "up" : "down");
      setTimeout(() => setBubbles((b) => b.filter((x) => !next.some((n) => n.id === x.id))), 2300);
    }
  }, [candles, trades, interval, frame]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(id);
  }, [flash]);

  const lastMc = trades?.length ? trades[trades.length - 1].mcAfter : mcUsd;
  const firstMc = candles.length ? candles[0].open : lastMc;
  const change = firstMc ? ((lastMc - firstMc) / firstMc) * 100 : 0;

  return (
    <section className="spotlight card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">Market cap</div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-semibold tabular-nums transition-colors ${
                flash === "up" ? "mc-flash-up" : flash === "down" ? "mc-flash-down" : ""
              }`}
            >
              {fmtUsdCompact(lastMc)}
            </span>
            {candles.length > 0 && (
              <span className={`text-sm font-semibold ${change >= 0 ? "text-up" : "text-down"}`}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-sol" />
            {live ? "Live" : "Demo"}
          </span>
          <div className="flex gap-0.5 rounded-xl bg-ink p-1" role="tablist" aria-label="Candle timeframe">
            {(Object.keys(FRAMES) as Frame[]).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={frame === f}
                onClick={() => setFrame(f)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  frame === f ? "bg-panel2 text-white" : "text-muted hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mt-3 h-[340px]">
        <div ref={box} className="absolute inset-0" />
        {/* Trade pop-ups */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {bubbles.map((b) => (
            <div key={b.id} className="absolute" style={{ left: b.x, top: b.y }}>
              <span className={`trade-ring ${b.side === "buy" ? "bg-up" : "bg-down"}`} />
              <span
                className={`trade-pop whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold shadow-pop ${
                  b.side === "buy" ? "bg-up text-black" : "bg-down text-white"
                }`}
              >
                {b.side === "buy" ? "+" : "−"}
                {b.sol.toFixed(b.sol < 0.1 ? 3 : 2)} SOL
              </span>
            </div>
          ))}
        </div>
        {trades === null && !error && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">Loading chart…</div>
        )}
        {error && trades === null && (
          <div className="absolute inset-0 grid place-items-center text-sm text-down">Couldn&apos;t load trades. Retrying…</div>
        )}
        {trades !== null && trades.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-center text-sm text-muted">
            No trades yet.
            <br />
            The first buy starts the chart.
          </div>
        )}
      </div>
    </section>
  );
}
