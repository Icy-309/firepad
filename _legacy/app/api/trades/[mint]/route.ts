import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { connection } from "@/lib/server/connection";
import { processState } from "@/lib/server/process-state";
import { fetchTokenStates, tokenStatePda } from "@/lib/program";
import { CURVE } from "@/lib/curve";
import { getSolUsd } from "@/lib/server/sol-price";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One curve-moving event, parsed from the program's logs. Amounts are raw (lamports / 6-dp tokens). */
interface Event {
  id: string; // signature:index
  sig: string;
  slot: number;
  at: number; // ms
  side: "buy" | "sell" | "fee";
  wallet: string;
  sol: bigint; // SOL into (buy) or out of (sell, fee) the curve
  tokens: bigint; // tokens out of (buy) or into (sell, fee) the curve
}

// Match the msg! lines in buy.rs / sell.rs / fees.rs.
const BUY_RE = /^Program log: BUY (\d+) SOL -> (\d+) tokens/;
const SELL_RE = /^Program log: SELL \d+ tokens -> (\d+) SOL \(curve received (\d+)\)/;
const FEE_RE = /^Program log: FEES (\d+) tokens -> (\d+) SOL/;

const MAX_EVENTS = 2000;
const MIN_REFRESH_MS = 3000;

interface Cache {
  events: Event[]; // newest first
  newestSig: string | null;
  fetchedAt: number;
  inflight: Promise<void> | null;
}
const caches = processState("tradeCaches", () => new Map<string, Cache>());

async function refresh(mint: PublicKey, c: Cache) {
  const ts = tokenStatePda(mint);
  // New signatures since the newest we've seen (all of them on first load, up to MAX_EVENTS).
  const sigs: { signature: string; slot: number; blockTime?: number | null; err: unknown }[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await connection.getSignaturesForAddress(ts, { limit: 1000, before, until: c.newestSig ?? undefined });
    sigs.push(...page);
    if (page.length < 1000 || sigs.length >= MAX_EVENTS) break;
    before = page[page.length - 1].signature;
  }
  const ok = sigs.filter((s) => !s.err);
  const fresh: Event[] = [];
  for (let i = 0; i < ok.length; i += 50) {
    const chunk = ok.slice(i, i + 50);
    const txs = await connection.getTransactions(
      chunk.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0, commitment: "confirmed" }
    );
    txs.forEach((tx, j) => {
      if (!tx?.meta?.logMessages || tx.meta.err) return;
      const sig = chunk[j].signature;
      const wallet = tx.transaction.message.staticAccountKeys[0].toBase58();
      const at = (tx.blockTime ?? chunk[j].blockTime ?? Date.now() / 1000) * 1000;
      let n = 0;
      for (const line of tx.meta.logMessages) {
        const b = BUY_RE.exec(line);
        const s = SELL_RE.exec(line);
        const f = FEE_RE.exec(line);
        const base = { sig, slot: tx.slot, at, wallet };
        if (b) fresh.push({ ...base, id: `${sig}:${n++}`, side: "buy", sol: BigInt(b[1]), tokens: BigInt(b[2]) });
        else if (s) fresh.push({ ...base, id: `${sig}:${n++}`, side: "sell", sol: BigInt(s[1]), tokens: BigInt(s[2]) });
        else if (f) fresh.push({ ...base, id: `${sig}:${n++}`, side: "fee", sol: BigInt(f[2]), tokens: BigInt(f[1]) });
      }
    });
  }
  // Newest first: by slot, then by order within the transaction.
  fresh.sort((a, b) => b.slot - a.slot || Number(b.id.split(":")[1]) - Number(a.id.split(":")[1]));
  c.events = [...fresh, ...c.events].slice(0, MAX_EVENTS);
  if (sigs.length) c.newestSig = sigs[0].signature;
  c.fetchedAt = Date.now();
}

/**
 * GET /api/trades/<mint> → { trades: [...] } oldest → newest, each with the market cap
 * (USD) before and after it. Market caps are exact: we start from the coin's current
 * on-chain reserves and undo events newest → oldest, so a partial history still works.
 */
export async function GET(_req: Request, { params }: { params: { mint: string } }) {
  let mint: PublicKey;
  try {
    mint = new PublicKey(params.mint);
  } catch {
    return NextResponse.json({ error: "bad mint" }, { status: 400 });
  }
  const id = mint.toBase58();
  let c = caches.get(id);
  if (!c) {
    c = { events: [], newestSig: null, fetchedAt: 0, inflight: null };
    caches.set(id, c);
  }
  try {
    if (Date.now() - c.fetchedAt > MIN_REFRESH_MS) {
      c.inflight ??= refresh(mint, c).finally(() => (c!.inflight = null));
      await c.inflight;
    }
    const [states, solUsd] = await Promise.all([fetchTokenStates(connection, [mint]), getSolUsd()]);
    const state = states.get(id);
    if (!state) return NextResponse.json({ trades: [] });

    const mcUsd = (vSol: bigint, vTok: bigint) =>
      ((Number(vSol) / 1e9) / (Number(vTok) / 10 ** CURVE.decimals)) * CURVE.totalSupply * solUsd;
    let vSol = state.virtualSolReserves;
    let vTok = state.virtualTokenReserves;
    const out = [];
    for (const e of c.events) {
      const after = mcUsd(vSol, vTok);
      // Undo the event to get the reserves before it.
      if (e.side === "buy") {
        vSol -= e.sol;
        vTok += e.tokens;
      } else {
        vSol += e.sol;
        vTok -= e.tokens;
      }
      if (vSol <= 0n || vTok <= 0n) break; // history older than what the reserves can explain
      out.push({
        id: e.id,
        sig: e.sig,
        side: e.side,
        wallet: e.wallet,
        sol: Number(e.sol) / 1e9,
        tokens: Number(e.tokens) / 10 ** CURVE.decimals,
        at: e.at,
        mcBefore: mcUsd(vSol, vTok),
        mcAfter: after,
      });
    }
    return NextResponse.json(
      { trades: out.reverse(), mcUsd: mcUsd(state.virtualSolReserves, state.virtualTokenReserves), solUsd },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[trades]", e);
    return NextResponse.json({ error: "Couldn't load trades" }, { status: 502 });
  }
}
