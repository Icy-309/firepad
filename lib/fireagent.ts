/** FIREAGENT constants shared by the browser and the server. */

export const BRAND = "FIREAGENT";

/** The split pump.fun enforces on every connected coin's creator fee. */
export const CREATOR_SHARE_BPS = 5_000;
export const AGENT_SHARE_BPS = 5_000;

/**
 * The agent wallet named as the second shareholder. Holders are paid from it.
 * Public on purpose: anyone can check a coin's split points here.
 */
export const AGENT_WALLET = process.env.NEXT_PUBLIC_FIREAGENT_WALLET || "";
