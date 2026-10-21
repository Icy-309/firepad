import type { CurveState } from "./curve";

/** A coin connected to FIREAGENT, with its live pump.fun curve. */
export interface Token {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image: string;
  /** Optional socials (https URLs). */
  website?: string;
  twitter?: string;
  telegram?: string;
  creator: string;
  /** When it joined FIREAGENT. */
  createdAt: number;
  source: "launch" | "connect";
  priceSol: number;
  marketCapSol: number;
  /** Stats that need an indexer are null until one exists. */
  change24h: null;
  volume24hSol: null;
  holders: number | null;
  /** Creator fees distributed through FIREAGENT (both halves), in SOL. */
  feesCollectedSol: number;
  /** Bonding-curve progress toward graduation, 0..1. */
  bondingProgress: number;
  curve: CurveState;
  live: true;
  /** Curve sold out: trading moved to PumpSwap. */
  complete: boolean;
  /** SOL paid out to holders so far. */
  holderFeesSol: number;
  /** The holders' half waiting for the next payout. */
  holderPoolSol: number;
  /** SOL raised by the curve so far. */
  raisedSol: number;
}
