/**
 * pump.fun's bonding curve (constant product on virtual reserves), with its launch
 * parameters. Amounts are in whole SOL / whole tokens (floats): fine for quotes and
 * display; pump.fun does the exact integer math on chain.
 */

export const CURVE = {
  initialVirtualSol: 30,
  initialVirtualTokens: 1_073_000_000,
  /** Sold through the curve; the remaining 206.9M is reserved for DEX liquidity. */
  initialRealTokens: 793_100_000,
  totalSupply: 1_000_000_000,
  decimals: 6,
} as const;

export interface CurveState {
  virtualSol: number;
  virtualTokens: number;
  realTokens: number;
}

export const INITIAL_CURVE: CurveState = {
  virtualSol: CURVE.initialVirtualSol,
  virtualTokens: CURVE.initialVirtualTokens,
  realTokens: CURVE.initialRealTokens,
};

export const priceSol = (c: CurveState) => c.virtualSol / c.virtualTokens;
export const marketCapSol = (c: CurveState) => priceSol(c) * CURVE.totalSupply;
export const realSolRaised = (c: CurveState) => c.virtualSol - CURVE.initialVirtualSol;
/** 0..1 — share of the sellable supply already bought. */
export const progress = (c: CurveState) => 1 - c.realTokens / CURVE.initialRealTokens;

/** State after `tokensSold` tokens have left the curve (net of sells). */
export function curveAfterSold(tokensSold: number): CurveState {
  const sold = Math.min(Math.max(tokensSold, 0), CURVE.initialRealTokens);
  const k = CURVE.initialVirtualSol * CURVE.initialVirtualTokens;
  const virtualTokens = CURVE.initialVirtualTokens - sold;
  return { virtualSol: k / virtualTokens, virtualTokens, realTokens: CURVE.initialRealTokens - sold };
}

/**
 * Quote a buy of `solIn`. All SOL goes to the curve; the token transfer fee is
 * withheld from the tokens. `feeSol` is the fee's value at the post-trade price
 * (what it roughly becomes once auto-swapped). Caps at the remaining supply like the program.
 */
export function quoteBuy(c: CurveState, solIn: number, feeBps: number) {
  const k = c.virtualSol * c.virtualTokens;
  let solSpent = solIn;
  let tokens = c.virtualTokens - k / (c.virtualSol + solIn);
  let capped = false;
  if (tokens > c.realTokens) {
    tokens = c.realTokens;
    solSpent = k / (c.virtualTokens - tokens) - c.virtualSol;
    capped = true;
  }
  const feeTokens = (tokens * feeBps) / 10_000;
  const priceAfter = (c.virtualSol + solSpent) / (c.virtualTokens - tokens);
  return { tokens: tokens - feeTokens, feeTokens, feeSol: feeTokens * priceAfter, solSpent, capped };
}

/** Quote a sell of `tokensIn`: the curve pays for what's left after the token fee. */
export function quoteSell(c: CurveState, tokensIn: number, feeBps: number) {
  const feeTokens = (tokensIn * feeBps) / 10_000;
  const received = tokensIn - feeTokens;
  const k = c.virtualSol * c.virtualTokens;
  const solOut = c.virtualSol - k / (c.virtualTokens + received);
  return { solOut, feeTokens, feeSol: feeTokens * (solOut / Math.max(received, 1e-9)) };
}
