import type { Token, Trade, Position } from "./types";
import { CURVE, curveAfterSold, marketCapSol, priceSol, progress, realSolRaised } from "./curve";

/** Derive price / market cap / progress from how far along the curve a mock token is. */
function onCurve(p: number) {
  const curve = curveAfterSold(p * CURVE.initialRealTokens);
  return {
    curve,
    priceSol: priceSol(curve),
    marketCapSol: marketCapSol(curve),
    bondingProgress: progress(curve),
    raisedSol: realSolRaised(curve),
    live: false,
    complete: false,
  };
}

const now = Date.now();
const mins = (m: number) => now - m * 60_000;

export const TOKENS: Token[] = [
  {
    mint: "AkpHepSNu1GEMGYPsS7qMvSpLkYrHthaakzwMCxRfire",
    name: "Solar Cat",
    symbol: "SCAT",
    description: "The first cat to claim fees just for holding. 50% of every trade flows to holders.",
    image: "https://picsum.photos/seed/scat/200",
    website: "https://example.com/",
    twitter: "https://x.com/solana",
    telegram: "https://t.me/solana",
    creator: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    createdAt: mins(14),
    change24h: 42.1,
    holders: 318,
    volume24hSol: 1204.5,
    feesCollectedSol: 12.04,
    ...onCurve(0.62),
  },
  {
    mint: "GS4cDFsdtpWMmwWHmqkk2toM4jUPwXS7GDgRUbuKfire",
    name: "Moon Doge",
    symbol: "MDOGE",
    description: "Hold and earn. Every sell pays the diamond hands.",
    image: "https://picsum.photos/seed/mdoge/200",
    creator: "4Nd8kLmPqRsTuVwXyZ1a2b3c4d5e6f7g8h9iJkLmNoP",
    createdAt: mins(47),
    change24h: -8.4,
    holders: 142,
    volume24hSol: 603.1,
    feesCollectedSol: 6.03,
    ...onCurve(0.31),
  },
  {
    mint: "GAcC1TXgo3BuAJZfVtCKG8MX3bs4YLyGfuRhGhD4fire",
    name: "Pepe Launch",
    symbol: "PLAUNCH",
    description: "Fair launch, friendly UI, fees shared with the community.",
    image: "https://picsum.photos/seed/plaunch/200",
    twitter: "https://x.com/solana",
    creator: "2Zq7rStUvWxYz1A2b3C4d5E6f7G8h9I0jK1l2M3n4O5p",
    createdAt: mins(96),
    change24h: 128.9,
    holders: 921,
    volume24hSol: 4821.0,
    feesCollectedSol: 48.21,
    ...onCurve(0.89),
  },
  {
    mint: "9hmpsPFz4tZLS1bxi7urdCDasbqtq95Dd8ubuLXFfire",
    name: "Flappy Bird Coin",
    symbol: "FLAP",
    description: "Tap to fly, hold to earn.",
    image: "https://picsum.photos/seed/flap/200",
    creator: "6Mn9oPqRsTuVwXyZ1a2b3c4d5e6f7g8h9iJkLmNoPqR",
    createdAt: mins(210),
    change24h: 3.2,
    holders: 77,
    volume24hSol: 188.4,
    feesCollectedSol: 1.88,
    ...onCurve(0.18),
  },
  {
    mint: "6s3F59x6i2uvH8n77nN2FTQifNwnJR8KiT94xxbXfire",
    name: "Ember",
    symbol: "EMBR",
    description: "Slow burn, steady rewards. A community coin for long-term holders.",
    image: "https://picsum.photos/seed/ember/200",
    creator: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    createdAt: mins(5),
    change24h: 18.6,
    holders: 54,
    volume24hSol: 96.2,
    feesCollectedSol: 0.96,
    ...onCurve(0.09),
  },
  {
    mint: "AKd6aMVkgynXZap3cMe9WPZFV6ZYVMGkaDvyjwCHfire",
    name: "Purple Rain",
    symbol: "PRAIN",
    description: "Raining fees on every holder since day one.",
    image: "https://picsum.photos/seed/prain/200",
    creator: "4Nd8kLmPqRsTuVwXyZ1a2b3c4d5e6f7g8h9iJkLmNoP",
    createdAt: mins(330),
    change24h: 64.3,
    holders: 1480,
    volume24hSol: 7302.7,
    feesCollectedSol: 73.03,
    ...onCurve(0.97),
  },
];

export function getToken(mint: string): Token | undefined {
  return TOKENS.find((t) => t.mint === mint);
}

export function mockTrades(mint: string): Trade[] {
  const t = getToken(mint);
  const base = t ? t.priceSol : 0.00001;
  const wallets = [
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    "4Nd8kLmPqRsTuVwXyZ1a2b3c4d5e6f7g8h9iJkLmNoP",
    "2Zq7rStUvWxYz1A2b3C4d5E6f7G8h9I0jK1l2M3n4O5p",
    "6Mn9oPqRsTuVwXyZ1a2b3c4d5e6f7g8h9iJkLmNoPqR",
  ];
  return Array.from({ length: 12 }).map((_, i) => {
    const side: Trade["side"] = Math.random() > 0.45 ? "buy" : "sell";
    const amountSol = +(Math.random() * 4 + 0.1).toFixed(3);
    return {
      id: `${mint}-${i}`,
      side,
      wallet: wallets[i % wallets.length],
      amountSol,
      tokens: Math.round(amountSol / base),
      at: now - i * 73_000,
    };
  });
}

export function mockPosition(mint: string): Position {
  const t = getToken(mint);
  const balance = 1_250_000;
  const price = t ? t.priceSol : 0.00001;
  return {
    mint,
    balance,
    valueSol: +(balance * price).toFixed(4),
    claimableSol: +(Math.random() * 0.4 + 0.05).toFixed(4),
    lifetimeEarnedSol: +(Math.random() * 2 + 0.2).toFixed(4),
  };
}
