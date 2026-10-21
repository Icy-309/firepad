import { PublicKey } from "@solana/web3.js";
import { connection } from "./connection";
import { getMetadata } from "./store";
import { decodeMetaplexMetadata, decodeMintMetadata, metaplexPda } from "@/lib/token-meta";
import { normalizeSocials } from "@/lib/socials";

export interface CoinInfo {
  name: string;
  symbol: string;
  description: string;
  image: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}

const MAX_JSON_BYTES = 64_000;

/**
 * The coin's off-chain JSON (pump.fun style). Any creator picks this URL, so only
 * public https hosts, no redirects, a short timeout and a size cap.
 */
async function fetchJson(uri: string): Promise<Record<string, unknown> | null> {
  try {
    const url = new URL(uri.replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/"));
    if (url.protocol !== "https:" || /^(localhost|[\d.]+|\[.*\])$/i.test(url.hostname) || url.port) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000), redirect: "error", cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_JSON_BYTES) return null;
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const httpsUrl = (v: unknown) => {
  const s = str(v, 500);
  return /^https:\/\//i.test(s) ? s : s.startsWith("ipfs://") ? s.replace("ipfs://", "https://ipfs.io/ipfs/") : "";
};

/**
 * Name, ticker, image and socials for any pump.fun coin: our own record when it
 * was launched here by `creator`, otherwise the chain + its metadata JSON.
 */
export async function coinInfo(mint: string, creator?: string): Promise<CoinInfo | null> {
  const ours = await getMetadata(mint);
  if (ours && (!creator || ours.creator === creator)) {
    const { name, symbol, description, image, website, twitter, telegram } = ours;
    return { name, symbol, description, image, website, twitter, telegram };
  }

  const key = new PublicKey(mint);
  const [mintInfo, mplInfo] = await connection.getMultipleAccountsInfo([key, metaplexPda(key)]);
  const onchain = (mintInfo && decodeMintMetadata(mintInfo.data)) || (mplInfo && decodeMetaplexMetadata(mplInfo.data));
  if (!onchain) return null;
  const json = onchain.uri ? await fetchJson(onchain.uri) : null;
  const { socials } = normalizeSocials({
    website: str(json?.website, 200),
    twitter: str(json?.twitter, 200),
    telegram: str(json?.telegram, 200),
  });
  return {
    name: onchain.name,
    symbol: onchain.symbol,
    description: str(json?.description, 1000),
    image: httpsUrl(json?.image),
    website: socials.website || undefined,
    twitter: socials.twitter || undefined,
    telegram: socials.telegram || undefined,
  };
}
