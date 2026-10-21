/** Off-chain metadata JSON, pump.fun-style: socials as optional top-level fields. */
export function metadataJson(m: {
  name: string;
  symbol: string;
  description: string;
  image: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}): Record<string, string> {
  const out: Record<string, string> = { name: m.name, symbol: m.symbol, description: m.description, image: m.image };
  if (m.website) out.website = m.website;
  if (m.twitter) out.twitter = m.twitter;
  if (m.telegram) out.telegram = m.telegram;
  return out;
}
