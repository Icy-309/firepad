/**
 * Optional coin socials (client + server). Inputs are forgiving — "@handle",
 * "x.com/handle", "t.me/group", "mycoin.xyz" — and come out as clean https URLs.
 * Anything that doesn't fit returns null, which callers treat as invalid.
 */

export interface Socials {
  website: string;
  twitter: string;
  telegram: string;
}

export const EMPTY_SOCIALS: Socials = { website: "", twitter: "", telegram: "" };

const HANDLE = /^[A-Za-z0-9_]{1,32}$/;

export function normalizeTwitter(input: string): string | null {
  const v = input.trim();
  if (!v) return "";
  const m = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,32})\/?(?:[?#].*)?$/i.exec(v);
  const handle = (m ? m[1] : v).replace(/^@/, "");
  return HANDLE.test(handle) ? `https://x.com/${handle}` : null;
}

export function normalizeTelegram(input: string): string | null {
  const v = input.trim();
  if (!v) return "";
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(\+?[A-Za-z0-9_]{3,64})\/?$/i.exec(v);
  const name = (m ? m[1] : v).replace(/^@/, "");
  return /^\+?[A-Za-z0-9_]{3,64}$/.test(name) ? `https://t.me/${name}` : null;
}

export function normalizeWebsite(input: string): string | null {
  const v = input.trim();
  if (!v) return "";
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return null;
    if (withScheme.length > 200) return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}

/** Normalize all three; `errors` names the fields that didn't parse. */
export function normalizeSocials(s: Partial<Socials>): { socials: Socials; errors: (keyof Socials)[] } {
  const out = {
    website: normalizeWebsite(s.website ?? ""),
    twitter: normalizeTwitter(s.twitter ?? ""),
    telegram: normalizeTelegram(s.telegram ?? ""),
  };
  const errors = (Object.keys(out) as (keyof Socials)[]).filter((k) => out[k] === null);
  return {
    socials: { website: out.website ?? "", twitter: out.twitter ?? "", telegram: out.telegram ?? "" },
    errors,
  };
}
