"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts from 0 to `value` when it scrolls into view. Renders the final value on
 * the server (and for reduced-motion users) so nothing is wrong before it animates.
 */
export function CountUp({
  value,
  format,
  duration = 1100,
}: {
  value: number;
  format: "usd" | "num" | "pct";
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        setShown(value * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      setShown(0);
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {fmt(shown, format)}
    </span>
  );
}

function fmt(n: number, f: "usd" | "num" | "pct") {
  if (f === "pct") return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const prefix = f === "usd" ? "$" : "";
  if (n >= 1e6) return `${prefix}${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${prefix}${(n / 1e3).toFixed(1)}K`;
  return `${prefix}${n.toFixed(0)}`;
}
