// Rising ember particles. Deterministic layout so server and client render match.
const COLORS = ["#FF5A1F", "#FFB224", "#FF3D0F", "#FFD54A", "#FF8A3D"];

export function Embers({ count = 26 }: { count?: number }) {
  return (
    <div className="embers" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
        const size = 2 + r(1) * 4;
        const color = COLORS[i % COLORS.length];
        return (
          <span
            key={i}
            style={
              {
                left: `${r(2) * 100}%`,
                width: size,
                height: size,
                background: color,
                boxShadow: `0 0 ${size * 3}px ${color}`,
                animationDuration: `${5 + r(3) * 6}s`,
                animationDelay: `${-r(4) * 10}s`,
                "--drift": `${(r(5) - 0.5) * 80}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
