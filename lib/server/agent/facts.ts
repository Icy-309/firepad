import type { Token } from "@/lib/types";
import type { CoinFacts } from "./kit";

/** Public base URL for links the agent posts (must be the real site in production). */
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

export function toFacts(t: Token): CoinFacts {
  return {
    mint: t.mint,
    name: t.name,
    symbol: t.symbol,
    description: t.description,
    url: `${siteUrl()}/token/${t.mint}`,
    website: t.website,
    twitter: t.twitter,
    telegram: t.telegram,
  };
}
