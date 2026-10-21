/**
 * List a coin on FIREAGENT once its 50/50 split is on chain. Retries a few times:
 * right after confirmation the server's RPC can still be a slot behind.
 */
export async function registerCoin(mint: string, attempts = 4): Promise<void> {
  let error = "Couldn't list the coin";
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500 * i));
    const res = await fetch("/api/coins/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint }),
    });
    if (res.ok) return;
    error = (await res.json().catch(() => ({}))).error || error;
    // 409: split not visible yet (retry). 503: RPC hiccup (retry). Anything else won't change.
    if (res.status !== 409 && res.status !== 503) break;
  }
  throw new Error(error);
}
