export const FLAME_PIXELS = [
  "........1.......",
  ".......111......",
  "......11111.....",
  ".....111111.....",
  ".....1111111....",
  "....11111111....",
  "...111111111....",
  "...1111111111...",
  "..11111111111...",
  "..111111111111..",
  "..111111111111..",
  "...1111111111...",
  "....11111111....",
  ".....111111.....",
  "......1111......",
  ".......11.......",
];
export const CORE_PIXELS = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  ".......22.......",
  "......2222......",
  "......22222.....",
  ".....222222.....",
  ".....222222.....",
  "......22222.....",
  ".......2222.....",
  "........22......",
  "................",
  "................",
];
const PIXEL_COLORS: Record<string, string> = { "1": "#dc143c", "2": "#ff7189" };

export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      role="img"
      aria-label="FIREPAD"
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated" }}
    >
      {FLAME_PIXELS.flatMap((row, y) =>
        [...row].flatMap((pixel, x) =>
          pixel === "." ? [] : (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={PIXEL_COLORS[pixel]} />
          )
        )
      )}
      {CORE_PIXELS.flatMap((row, y) =>
        [...row].flatMap((pixel, x) =>
          pixel === "." ? [] : (
            <rect key={`core-${x}-${y}`} x={x} y={y} width="1" height="1" fill={PIXEL_COLORS[pixel]} />
          )
        )
      )}
    </svg>
  );
}

/** Flame mark + "FIREPAD" wordmark. */
export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="group flex items-center gap-2">
      <Logo size={size} />
      <span className="font-pixel text-[11px] tracking-[0.03em] text-white">
        FIREPAD
      </span>
    </span>
  );
}
