import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import type { BondingCurve } from "@pump-fun/pump-sdk";
import type { Token } from "@/lib/types";
import { INITIAL_CURVE, marketCapSol, priceSol, progress, realSolRaised } from "@/lib/curve";
import { assertMainnetConnection, connection } from "./connection";
import { fetchCurves, toCurveState } from "./pump";
import { getCoin, listCoins, type CoinRecord } from "./fireagent-store";

function toToken(c: CoinRecord, bc: BondingCurve | undefined): Token {
  const curve = bc ? toCurveState(bc) : INITIAL_CURVE;
  return {
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    description: c.description,
    image: c.image || `https://picsum.photos/seed/${c.mint}/200`,
    website: c.website,
    twitter: c.twitter,
    telegram: c.telegram,
    creator: c.creator,
    createdAt: c.connectedAt,
    source: c.source,
    curve,
    priceSol: priceSol(curve),
    marketCapSol: marketCapSol(curve),
    bondingProgress: bc?.complete ? 1 : progress(curve),
    raisedSol: realSolRaised(curve),
    complete: !!bc?.complete,
    live: true,
    change24h: null,
    volume24hSol: null,
    holders: c.holders,
    feesCollectedSol: c.distributedLamports / LAMPORTS_PER_SOL,
    holderFeesSol: c.holderPaidLamports / LAMPORTS_PER_SOL,
    holderPoolSol: c.holderPoolLamports / LAMPORTS_PER_SOL,
  };
}

/** Every coin on FIREPAD, priced from its mainnet pump.fun curve. */
export async function listLiveTokens(): Promise<Token[]> {
  const coins = await listCoins();
  if (!coins.length) return [];
  await assertMainnetConnection();
  const curves = await fetchCurves(connection, coins.map((c) => new PublicKey(c.mint))).catch((e) => {
    console.error("[tokens] RPC error", e);
    return new Map<string, BondingCurve>();
  });
  return coins.map((c) => toToken(c, curves.get(c.mint)));
}

export async function getLiveToken(mint: string): Promise<Token | null> {
  const coin = await getCoin(mint);
  if (!coin) return null;
  await assertMainnetConnection();
  const curves = await fetchCurves(connection, [new PublicKey(mint)]).catch(() => new Map<string, BondingCurve>());
  return toToken(coin, curves.get(mint));
}
