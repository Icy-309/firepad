/**
 * Guardrails for everything the agent publishes. Memecoin marketing is where scams
 * live, so the agent never promises returns, predicts prices, or claims safety.
 */

const BANNED = [
  /guarantee/i,
  /risk[- ]?free/i,
  /can'?t lose|cannot lose|no way to lose/i,
  /\b\d{2,5}\s*x\b/i, // "100x", "1000 x"
  /to the moon|moonshot|going parabolic/i,
  /financial advice/i,
  /(price|it) (will|is going to) (go up|pump|rise|explode|moon)/i,
  /easy money|free money|get rich/i,
  /\bsafe (investment|bet)\b/i,
  /last chance|act now|don'?t miss out/i,
];

/** null if the text breaks a rule, else the cleaned text. */
export function vet(text: string): string | null {
  const t = text.replace(/\s+\n/g, "\n").trim();
  if (!t) return null;
  if (BANNED.some((re) => re.test(t))) return null;
  return t;
}

export const RULES = `Hard rules — never break them:
- Never promise or imply profit, returns, price targets or multiples (no "100x", "moon", "guaranteed", "can't lose").
- Never predict what the price will do. Describe only facts: what the coin is, on-chain milestones, how fees work.
- Never claim the coin is safe or an investment. No urgency or FOMO lines ("last chance", "don't miss out").
- No emojis, no hashtag spam (at most two hashtags in a post).
- Plain, confident, fun language. Memes and lore are fine; financial claims are not.
- Every number you use must come from the facts given to you.`;

/** X counts every URL as 23 characters. */
export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}

export function fitsX(text: string): boolean {
  return xLength(text) <= 280;
}
