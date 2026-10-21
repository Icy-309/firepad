"use client";

import { useEffect, useRef, useState } from "react";
import { CORE_PIXELS, FLAME_PIXELS } from "./Logo";
import { fmtUsdCompact } from "@/lib/format";

const W = 720;
const H = 1280;
const FPS = 30;
const DURATION = 15;

interface Point {
  mc: number;
  side: "buy" | "sell";
  sol: number;
}

/**
 * Renders a 15s vertical promo video for a coin on a canvas and records it with
 * MediaRecorder (MP4 where the browser supports it, otherwise WebM): coin art, a market-cap
 * line with buy/sell pops, the fee pitch, and a "CA ends in fire" outro.
 */
export function VideoMaker({
  mint,
  name,
  symbol,
  image,
  lines,
  points,
}: {
  mint: string;
  name: string;
  symbol: string;
  image: string;
  lines: string[];
  points: Point[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<{ url: string; ext: string } | null>(null);
  const [error, setError] = useState("");

  // Load the coin art with CORS so the canvas stays exportable.
  useEffect(() => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => {
      img.current = i;
      drawFrame(0);
    };
    i.onerror = () => {
      img.current = null;
      drawFrame(0);
    };
    i.src = image;
    drawFrame(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  useEffect(() => () => (file ? URL.revokeObjectURL(file.url) : undefined), [file]);

  function drawFrame(t: number) {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    render(ctx, t, { mint, name, symbol, img: img.current, lines, points });
  }

  async function record() {
    const c = canvas.current;
    if (!c || typeof MediaRecorder === "undefined") {
      setError("This browser can't record video. Try Chrome or Edge.");
      setState("error");
      return;
    }
    const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) {
      setError("This browser can't record video. Try Chrome or Edge.");
      setState("error");
      return;
    }
    if (file) URL.revokeObjectURL(file.url);
    setFile(null);
    setError("");
    setState("recording");
    const stream = c.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(250);
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(DURATION, (performance.now() - start) / 1000);
        drawFrame(t);
        setProgress(t / DURATION);
        if (t < DURATION) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    setFile({ url: URL.createObjectURL(blob), ext: mime.startsWith("video/mp4") ? "mp4" : "webm" });
    setState("done");
    drawFrame(0);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
      <canvas ref={canvas} width={W} height={H} className="w-full max-w-[220px] rounded-2xl border border-line bg-black" />
      <div className="flex flex-col justify-center gap-3 text-sm">
        <p className="text-muted">
          A 15-second vertical video for TikTok, Reels and Shorts. It&apos;s made from this coin&apos;s art, its chart and its
          Launch Kit, and rendered right here in your browser.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={record} disabled={state === "recording"} className="btn-primary px-4 py-2.5">
            {state === "recording" ? `Rendering… ${Math.round(progress * 100)}%` : state === "done" ? "Render again" : "Render video"}
          </button>
          {file && (
            <a href={file.url} download={`${symbol}-firepad.${file.ext}`} className="btn-secondary px-4 py-2.5">
              Download .{file.ext}
            </a>
          )}
        </div>
        {state === "recording" && (
          <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
            <div className="h-full bg-gradient-to-r from-brand to-sol" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        {file && <p className="text-xs text-muted">Upload it to TikTok, Instagram Reels or YouTube Shorts.</p>}
        {error && <p className="text-xs text-down">{error}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frame renderer (pure function of time)

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const between = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
function flame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  const pixelSize = size / 16;
  const draw = (rows: string[], color: string) => {
    ctx.fillStyle = color;
    rows.forEach((row, py) => {
      [...row].forEach((pixel, px) => {
        if (pixel !== ".") ctx.fillRect(x - size / 2 + px * pixelSize, y - size / 2 + py * pixelSize, pixelSize, pixelSize);
      });
    });
  };
  draw(FLAME_PIXELS, "#c4d99a");
  draw(CORE_PIXELS, "#d9bd82");
  ctx.restore();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = "#fff", weight = 800, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "VT323", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Wrap to the canvas width.
  const words = s.split(" ");
  const rows: string[] = [];
  let row = "";
  for (const w of words) {
    const next = row ? `${row} ${w}` : w;
    if (ctx.measureText(next).width > W - 100 && row) {
      rows.push(row);
      row = w;
    } else row = next;
  }
  rows.push(row);
  rows.forEach((r, i) => ctx.fillText(r, x, y + (i - (rows.length - 1) / 2) * size * 1.2));
  ctx.restore();
}

function render(
  ctx: CanvasRenderingContext2D,
  t: number,
  d: { mint: string; name: string; symbol: string; img: HTMLImageElement | null; lines: string[]; points: Point[] }
) {
  // Background + embers
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#17211e");
  bg.addColorStop(1, "#0b100f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const seed = Math.sin(i * 91.7) * 1000;
    const x = ((seed % 1) + 1) % 1 * W;
    const speed = 60 + ((i * 37) % 80);
    const y = H - ((t * speed + i * 97) % (H + 40));
    ctx.fillStyle = i % 2 ? "rgba(196,217,154,0.7)" : "rgba(217,189,130,0.6)";
    const pixelSize = 4 + (i % 3) * 2;
    ctx.fillRect(x, y, pixelSize, pixelSize);
  }

  const lines = d.lines.length ? d.lines : [`$${d.symbol} is live`, "Every trade pays holders", "50/50 split, locked", "CA ends in fire"];

  // Scene 1 (0–2.8s): coin art bursts in
  if (t < 3) {
    const k = ease(between(t, 0, 0.8));
    const r = 190 * k;
    ctx.save();
    ctx.shadowColor = "rgba(217,189,130,0.35)";
    ctx.shadowBlur = 60;
    ctx.beginPath();
    ctx.arc(W / 2, 520, r + 10, 0, Math.PI * 2);
    ctx.fillStyle = "#c4d99a";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, 520, r, 0, Math.PI * 2);
    ctx.clip();
    if (d.img) ctx.drawImage(d.img, W / 2 - r, 520 - r, r * 2, r * 2);
    else {
      ctx.fillStyle = "#1e1410";
      ctx.fillRect(W / 2 - r, 520 - r, r * 2, r * 2);
    }
    ctx.restore();
    text(ctx, `$${d.symbol}`, W / 2, 820, 96, "#fff", 800, ease(between(t, 0.5, 1.1)));
    text(ctx, d.name, W / 2, 910, 40, "#a8958a", 600, ease(between(t, 0.7, 1.3)));
    text(ctx, lines[0], W / 2, 1060, 46, "#FFB224", 700, ease(between(t, 1.1, 1.7)) * (1 - between(t, 2.6, 3)));
    return;
  }

  // Scene 2 (3–8s): the market cap climbs, trades pop
  if (t < 8) {
    const pts = d.points.length > 3 ? d.points : Array.from({ length: 24 }, (_, i) => ({ mc: 3000 * (1 + i * 0.12 + Math.sin(i) * 0.05), side: (i % 4 ? "buy" : "sell") as Point["side"], sol: 0.1 + (i % 5) * 0.2 }));
    const p = ease(between(t, 3.2, 7.4));
    const n = Math.max(2, Math.floor(pts.length * p));
    const shown = pts.slice(0, n);
    const min = Math.min(...pts.map((x) => x.mc));
    const max = Math.max(...pts.map((x) => x.mc));
    const X = (i: number) => 60 + (i / (pts.length - 1)) * (W - 120);
    const Y = (mc: number) => 960 - ((mc - min) / (max - min || 1)) * 520;
    text(ctx, "Market cap", W / 2, 230, 34, "#a8958a", 600);
    text(ctx, fmtUsdCompact(shown[shown.length - 1].mc), W / 2, 310, 92, "#fff", 800);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#FF5A1F");
    grad.addColorStop(1, "#FFB224");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.beginPath();
    shown.forEach((pt, i) => (i ? ctx.lineTo(X(i), Y(pt.mc)) : ctx.moveTo(X(i), Y(pt.mc))));
    ctx.stroke();
    // Pops for the newest few trades (points without a trade size have none)
    shown.slice(-3).forEach((pt, j) => {
      const i = shown.length - 3 + j;
      if (i < 0 || pt.sol <= 0) return;
      const x = X(i);
      const y = Y(pt.mc) - 40 - j * 6;
      ctx.fillStyle = pt.side === "buy" ? "#FFB224" : "#FF4433";
      ctx.beginPath();
      ctx.roundRect(x - 80, y - 26, 160, 52, 26);
      ctx.fill();
      text(ctx, `${pt.side === "buy" ? "+" : "-"}${pt.sol.toFixed(2)} SOL`, x, y + 1, 28, pt.side === "buy" ? "#000" : "#fff", 800);
    });
    text(ctx, lines[1], W / 2, 1110, 46, "#fff", 700, ease(between(t, 3.6, 4.2)));
    return;
  }

  // Scene 3 (8–12s): the pitch
  if (t < 12) {
    const a = ease(between(t, 8, 8.6));
    const b = ease(between(t, 9.2, 9.8));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(255,90,31,0.18)";
    ctx.beginPath();
    ctx.roundRect(70, 380, W - 140, 220, 36);
    ctx.fill();
    ctx.restore();
    text(ctx, "50% of creator fees", W / 2, 455, 58, "#fff", 800, a);
    text(ctx, "goes to holders", W / 2, 530, 50, "#FFB224", 700, a);
    ctx.save();
    ctx.globalAlpha = b;
    ctx.fillStyle = "rgba(255,178,36,0.12)";
    ctx.beginPath();
    ctx.roundRect(70, 660, W - 140, 220, 36);
    ctx.fill();
    ctx.restore();
    text(ctx, "Split locked", W / 2, 735, 58, "#fff", 800, b);
    text(ctx, "by pump.fun, for good", W / 2, 810, 44, "#FF5A1F", 700, b);
    text(ctx, lines[2], W / 2, 1060, 42, "#a8958a", 600, ease(between(t, 10, 10.6)));
    return;
  }

  // Scene 4 (12–15s): outro
  const k = ease(between(t, 12, 12.7));
  flame(ctx, W / 2, 470, 256 * k);
  text(ctx, "FIREPAD", W / 2, 700, 92, "#fff", 800, k);
  text(ctx, `$${d.symbol}`, W / 2, 820, 60, "#FFB224", 800, ease(between(t, 12.4, 13)));
  text(ctx, `CA …${d.mint.slice(-10, -4)}fire`, W / 2, 920, 40, "#a8958a", 600, ease(between(t, 12.6, 13.2)));
  text(ctx, lines[3] ?? lines[0], W / 2, 1080, 42, "#fff", 700, ease(between(t, 13, 13.6)));
}
