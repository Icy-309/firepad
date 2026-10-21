import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b100f",
        panel: "#101816",
        panel2: "#17211e",
        line: "#283630",
        brand: "#c4d99a",
        brand2: "#91a975",
        sol: "#d9bd82",
        up: "#91c99d",
        down: "#e28a82",
        muted: "#9ba9a2",
      },
      fontFamily: {
        sans: ["VT323", "ui-monospace", "monospace"],
        display: ["VT323", "ui-monospace", "monospace"],
        mono: ["VT323", "ui-monospace", "monospace"],
        pixel: ["Press Start 2P", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(196,217,154,0.18), 0 8px 40px -12px rgba(196,217,154,0.12)",
        pop: "0 24px 64px -16px rgba(0,0,0,0.7)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": { from: { opacity: "0", transform: "translateY(8px) scale(.98)" }, to: { opacity: "1", transform: "none" } },
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
      },
      animation: {
        "fade-in": "fade-in .15s ease-out",
        "pop-in": "pop-in .18s ease-out",
        marquee: "marquee 60s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
