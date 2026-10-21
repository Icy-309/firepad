import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * Claude for the marketing agent. Optional: with no ANTHROPIC_API_KEY the agent uses
 * its built-in templates instead (see kit.ts / posts.ts), so everything works without it.
 */
export const AGENT_MODEL = process.env.AGENT_MODEL || "claude-opus-5-5";

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client === undefined) client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  return client;
}

export const claudeEnabled = () => !!process.env.ANTHROPIC_API_KEY;

/**
 * One structured-output call. Returns null (caller falls back to templates) when Claude
 * isn't configured, declines, or errors — marketing copy must never block a launch.
 */
export async function generate<S extends z.ZodType>(
  schema: S,
  system: string,
  prompt: string,
  effort: "low" | "medium" | "high" = "low"
): Promise<z.infer<S> | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.beta.messages.parse({
      model: AGENT_MODEL,
      max_tokens: 16000,
      // Server-side fallback on a policy decline (routes by refusal category).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort, format: betaZodOutputFormat(schema) },
    });
    if (res.stop_reason === "refusal") {
      console.warn("[agent] Claude declined:", res.stop_details?.category ?? "unknown");
      return null;
    }
    return res.parsed_output ?? null;
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) console.warn("[agent] Claude rate-limited; using templates");
    else if (e instanceof Anthropic.AuthenticationError) console.error("[agent] ANTHROPIC_API_KEY rejected; using templates");
    else if (e instanceof Anthropic.APIError) console.error(`[agent] Claude API error ${e.status}: ${e.message}`);
    else console.error("[agent] Claude call failed:", e);
    return null;
  }
}
