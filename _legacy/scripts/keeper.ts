/**
 * firepad keeper — keeps the 50/50 fee split flowing.
 *
 *   npm run keeper
 *
 * Every tick, for each coin launched through this site:
 *   1. Sample holder balances (time-weighted: each interval is credited at the
 *      balance held at its start, so buying right before a sample earns nothing).
 *   2. Harvest fees withheld in token accounts into the mint, then `collect_fees`.
 *      Before graduation the program sells them into the curve and splits the SOL
 *      50/50 into the creator and holder vaults in the same instruction.
 *   3. Once per epoch, split the holder SOL credited since the last epoch by
 *      balance × time and publish a new merkle root (`set_rewards_root`). Holders
 *      claim on the coin page with proofs from /api/rewards/<mint>.
 *
 * Roots use a two-phase commit (pending → confirmed on-chain → committed), so a
 * crash mid-epoch never loses or double-counts allocations.
 *
 * After graduation, fee tokens are parked on-chain (`pending_fee_tokens`). On
 * mainnet the keeper takes them, swaps them to SOL through Jupiter (which routes
 * to the coin's Raydium CPMM pool, or wherever liquidity is) and deposits the SOL,
 * which the program splits 50/50. The SOL actually received is recorded before it
 * is deposited, so a crash in between is retried, never lost. Jupiter has no
 * devnet, so there the keeper only reports the backlog.
 *
 * Env: KEEPER_KEYPAIR (path to a solana-keygen JSON keypair; must match the
 * config's keeper), RPC_URL / NEXT_PUBLIC_RPC_URL, KEEPER_TICK_SECONDS (60),
 * KEEPER_EPOCH_MINUTES (60), KEEPER_MIN_EPOCH_SOL (0.001), KEEPER_SWAP_SLIPPAGE_BPS (300),
 * JUPITER_API (https://lite-api.jup.ag/swap/v1), KEEPER_MINTS (extra comma-separated mints to
 * process, e.g. coins not launched through this site). Reads .env.local like Next.js.
 */
import "./load-env"; // must be first: loads .env.local before anything reads process.env
import { promises as fsp, readFileSync } from "fs";
import path from "path";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { CLUSTER } from "../lib/rpc";
import { connection } from "../lib/server/connection";
import { listMetadata } from "../lib/server/store";
import { loadRewards, saveKeeperStatus, saveRewards, type KeeperStatus, type RewardsState } from "../lib/server/rewards-store";
import { buildTree, toHex } from "../lib/merkle";
import {
  ata2022,
  collectFeesIx,
  decodeMintFee,
  decodeTokenAmount,
  depositSwappedFeesIx,
  decodeTokenAccount,
  fetchConfig,
  fetchTokenStates,
  harvestToMintIx,
  migrateIx,
  raydiumPool,
  setRewardsRootIx,
  takeFeeTokensIx,
  TOKEN_2022_PROGRAM_ID,
  type OnchainTokenState,
} from "../lib/program";

const TICK_MS = Number(process.env.KEEPER_TICK_SECONDS || 60) * 1000;
const EPOCH_MS = Number(process.env.KEEPER_EPOCH_MINUTES || 60) * 60_000;
const MIN_EPOCH_LAMPORTS = BigInt(Math.round(Number(process.env.KEEPER_MIN_EPOCH_SOL || 0.001) * 1e9));
const HARVEST_BATCH = 20; // token accounts per harvest instruction (keeps the tx under the size limit)
const SWAP_SLIPPAGE_BPS = Number(process.env.KEEPER_SWAP_SLIPPAGE_BPS || 300);
const JUPITER_API = process.env.JUPITER_API || "https://lite-api.jup.ag/swap/v1";
const WSOL = "So11111111111111111111111111111111111111112";
const SWAPS_FILE = path.join(process.cwd(), "data", "keeper-swaps.json");

function loadKeypair(): Keypair {
  const file = process.env.KEEPER_KEYPAIR;
  if (!file) throw new Error("Set KEEPER_KEYPAIR to the keeper's keypair file");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
}

const keeper = loadKeypair();
const log = (mint: string, msg: string) => console.log(`[${new Date().toISOString()}] ${mint.slice(0, 6)}… ${msg}`);

async function send(...ixs: TransactionInstruction[]) {
  return sendWithUnits(400_000, ...ixs);
}

async function sendWithUnits(units: number, ...ixs: TransactionInstruction[]) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units }), ...ixs);
  return sendAndConfirmTransaction(connection, tx, [keeper], { commitment: "confirmed" });
}

/** Every Token-2022 account for `mint`: owner, balance, fees withheld in it. */
async function tokenAccounts(mint: PublicKey) {
  const accs = await connection
    .getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] })
    .catch((e) => {
      // Public endpoints (api.devnet/mainnet-beta.solana.com) refuse this for the token programs.
      if (String(e).includes("excluded from account secondary indexes")) {
        throw new Error("this RPC can't list Token-2022 accounts — set RPC_URL to a provider that can (Helius, Triton, QuickNode)");
      }
      throw e;
    });
  return accs.map((a) => ({ address: a.pubkey, ...decodeTokenAccount(a.account.data) }));
}

// ---------------------------------------------------------------------------
// rewards state

function commit(s: RewardsState, now: number) {
  const p = s.pending!;
  s.epoch = p.epoch;
  s.root = p.root;
  s.allocations = p.allocations;
  s.allocated = p.allocated;
  s.pending = null;
  s.balanceMs = {};
  s.lastEpochAt = now;
}

/** Finish (or drop) a root that was sent before a crash. */
function settlePending(mint: string, s: RewardsState, ts: OnchainTokenState): boolean {
  if (!s.pending) return false;
  if (ts.rewardsEpoch === s.pending.epoch && toHex(ts.rewardsRoot) === s.pending.root) {
    commit(s, Date.now());
    log(mint, `recovered epoch ${s.epoch} from a previous run`);
  } else if (ts.rewardsEpoch < s.pending.epoch) {
    log(mint, `dropping unsent epoch ${s.pending.epoch}`);
    s.pending = null;
  } else {
    throw new Error(`on-chain epoch ${ts.rewardsEpoch} doesn't match pending ${s.pending.epoch} — needs a human`);
  }
  return true;
}

/** Credit the interval since the last sample at the balances held at its start. */
function sample(s: RewardsState, balances: Map<string, bigint>, now: number) {
  const dt = s.lastSampleAt ? BigInt(Math.max(0, now - s.lastSampleAt)) : 0n;
  if (dt > 0n) {
    for (const [w, bal] of Object.entries(s.lastBalances)) {
      s.balanceMs[w] = (BigInt(s.balanceMs[w] ?? "0") + BigInt(bal) * dt).toString();
    }
  }
  s.lastBalances = Object.fromEntries([...balances].map(([w, b]) => [w, b.toString()]));
  s.lastSampleAt = now;
  s.holders = balances.size;
}

async function maybeEpoch(mint: PublicKey, s: RewardsState, ts: OnchainTokenState, now: number) {
  const id = mint.toBase58();
  if (now - s.lastEpochAt < EPOCH_MS) return;
  if (ts.rewardsRootTotal !== BigInt(s.allocated)) {
    throw new Error(`local allocated ${s.allocated} ≠ on-chain ${ts.rewardsRootTotal} — rewards data out of sync`);
  }
  const fresh = ts.holderFeesTotal - BigInt(s.allocated);
  const weights = Object.entries(s.balanceMs).map(([w, v]) => [w, BigInt(v)] as const).filter(([, v]) => v > 0n);
  const sum = weights.reduce((n, [, v]) => n + v, 0n);
  if (fresh < MIN_EPOCH_LAMPORTS || sum === 0n) return; // keep accumulating

  const allocations: Record<string, string> = { ...s.allocations };
  let distributed = 0n;
  for (const [w, v] of weights) {
    const share = (fresh * v) / sum; // floors; the dust carries into the next epoch
    if (share === 0n) continue;
    allocations[w] = (BigInt(allocations[w] ?? "0") + share).toString();
    distributed += share;
  }
  if (distributed === 0n) return;
  const allocated = BigInt(s.allocated) + distributed;
  const tree = buildTree(Object.fromEntries(Object.entries(allocations).map(([w, a]) => [w, BigInt(a)])));
  if (!tree) return;
  const epoch = ts.rewardsEpoch + 1;

  // Phase 1: persist what we're about to publish.
  s.pending = { epoch, root: toHex(tree.root), allocations, allocated: allocated.toString() };
  await saveRewards(id, s);
  // Phase 2: publish, then commit.
  const sig = await send(setRewardsRootIx(keeper.publicKey, mint, tree.root, allocated, epoch));
  commit(s, now);
  await saveRewards(id, s);
  log(id, `epoch ${epoch}: ${Number(distributed) / 1e9} SOL to ${weights.length} holders (${sig})`);
}

// ---------------------------------------------------------------------------
// graduated coins: swap parked fee tokens to SOL and deposit it

/** mint → lamports received from swaps but not yet deposited (crash-safe hand-off). */
async function loadSwaps(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fsp.readFile(SWAPS_FILE, "utf8"));
  } catch {
    return {};
  }
}
async function saveSwaps(s: Record<string, string>) {
  await fsp.mkdir(path.dirname(SWAPS_FILE), { recursive: true });
  const tmp = `${SWAPS_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(s, null, 2));
  await fsp.rename(tmp, SWAPS_FILE);
}

/** Swap `amount` raw tokens to SOL via Jupiter; returns the lamports the keeper actually gained. */
async function jupiterSell(mint: PublicKey, amount: bigint): Promise<{ lamports: bigint; sig: string }> {
  const q = new URLSearchParams({
    inputMint: mint.toBase58(),
    outputMint: WSOL,
    amount: amount.toString(),
    slippageBps: String(SWAP_SLIPPAGE_BPS),
  });
  const quoteRes = await fetch(`${JUPITER_API}/quote?${q}`);
  if (!quoteRes.ok) throw new Error(`Jupiter quote failed: ${quoteRes.status} ${await quoteRes.text()}`);
  const quoteResponse = await quoteRes.json();
  const swapRes = await fetch(`${JUPITER_API}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: keeper.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap failed: ${swapRes.status} ${await swapRes.text()}`);
  const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([keeper]);
  const latest = await connection.getLatestBlockhash();
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const conf = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  if (conf.value.err) throw new Error(`swap failed on-chain: ${JSON.stringify(conf.value.err)}`);
  // Measure what we really got (output minus nothing; the network fee is added back).
  const done = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!done?.meta) throw new Error(`can't read swap result ${sig}`);
  const gained = BigInt(done.meta.postBalances[0] - done.meta.preBalances[0] + done.meta.fee);
  return { lamports: gained > 0n ? gained : 0n, sig };
}

async function processGraduated(mint: PublicKey, ts: OnchainTokenState) {
  const id = mint.toBase58();
  const swaps = await loadSwaps();

  // 1) A previous run swapped but didn't deposit: deposit first.
  if (BigInt(swaps[id] ?? "0") > 0n) {
    const lamports = BigInt(swaps[id]);
    const sig = await send(depositSwappedFeesIx(keeper.publicKey, mint, lamports));
    delete swaps[id];
    await saveSwaps(swaps);
    log(id, `deposited ${Number(lamports) / 1e9} SOL from an earlier swap (${sig})`);
  }

  if (CLUSTER !== "mainnet-beta") {
    if (ts.pendingFeeTokens > 0n) log(id, `${ts.pendingFeeTokens} graduated fee tokens waiting (swaps need mainnet)`);
    return;
  }

  // 2) Take the parked fee tokens (that transfer is itself fee-charged; collected next round).
  if (ts.pendingFeeTokens > 0n) {
    const sig = await send(takeFeeTokensIx(keeper.publicKey, mint, ts.pendingFeeTokens));
    log(id, `took ${ts.pendingFeeTokens} fee tokens (${sig})`);
  }

  // 3) Swap everything in the keeper's account for this coin (includes leftovers from failed swaps).
  const info = await connection.getAccountInfo(ata2022(keeper.publicKey, mint));
  const balance = decodeTokenAmount(info?.data);
  if (balance === 0n) return;
  const { lamports, sig } = await jupiterSell(mint, balance);
  if (lamports === 0n) return;
  // 4) Record before depositing, so a crash here is retried by step 1.
  swaps[id] = lamports.toString();
  await saveSwaps(swaps);
  log(id, `swapped ${balance} tokens → ${Number(lamports) / 1e9} SOL (${sig})`);
  const dep = await send(depositSwappedFeesIx(keeper.publicKey, mint, lamports));
  delete swaps[id];
  await saveSwaps(swaps);
  log(id, `deposited ${Number(lamports) / 1e9} SOL, split 50/50 (${dep})`);
}

// ---------------------------------------------------------------------------

async function processMint(mint: PublicKey, isKeeper: boolean, status: KeeperStatus) {
  const id = mint.toBase58();
  const entry: KeeperStatus["tokens"][string] = { holders: 0, epoch: 0 };
  status.tokens[id] = entry;
  try {
    let ts = (await fetchTokenStates(connection, [mint])).get(id);
    if (!ts) return; // reserved but never launched
    const s = await loadRewards(id);
    if (settlePending(id, s, ts)) await saveRewards(id, s);

    // 1) sample balances: real wallets only (on-curve owners). This skips the curve
    //    vault and DEX pools (PDAs) and the keeper's own fee tokens.
    const accounts = await tokenAccounts(mint);
    const balances = new Map<string, bigint>();
    for (const a of accounts) {
      if (a.amount === 0n || !PublicKey.isOnCurve(a.owner.toBytes()) || a.owner.equals(keeper.publicKey)) continue;
      const w = a.owner.toBase58();
      balances.set(w, (balances.get(w) ?? 0n) + a.amount);
    }
    const now = Date.now();
    sample(s, balances, now);
    await saveRewards(id, s);
    entry.holders = s.holders;

    // 2) harvest withheld fees into the mint, then collect them.
    const withheld = accounts.filter((a) => a.withheld > 0n).map((a) => a.address);
    for (let i = 0; i < withheld.length; i += HARVEST_BATCH) {
      await send(harvestToMintIx(mint, withheld.slice(i, i + HARVEST_BATCH)));
    }
    const mintInfo = await connection.getAccountInfo(mint);
    const inMint = mintInfo ? decodeMintFee(mintInfo.data)?.withheldInMint ?? 0n : 0n;
    if (inMint > 0n) {
      const sig = await send(collectFeesIx(keeper.publicKey, mint));
      entry.lastCollectAt = Date.now();
      log(id, `collected ${inMint} fee tokens (${sig})`);
      ts = (await fetchTokenStates(connection, [mint])).get(id)!;
    }
    // Graduated: create the Raydium pool (permissionless; LP is burned on-chain).
    if (ts.complete && !ts.migrated) {
      const sig = await sendWithUnits(1_000_000, migrateIx(keeper.publicKey, mint));
      log(id, `migrated to Raydium pool ${raydiumPool(mint).pool.toBase58()} (${sig})`);
      ts = (await fetchTokenStates(connection, [mint])).get(id)!;
    }
    if (ts.complete && isKeeper) await processGraduated(mint, ts);

    // 3) epoch (needs the keeper key).
    if (isKeeper) {
      await maybeEpoch(mint, s, ts, now);
      if (s.lastEpochAt === now) entry.lastEpochAt = now;
    }
    entry.epoch = s.epoch;
  } catch (e) {
    entry.error = (e as Error).message;
    log(id, `error: ${entry.error}`);
  }
}

async function tick() {
  const config = await fetchConfig(connection);
  const isKeeper = !!config && config.keeper.equals(keeper.publicKey);
  if (!isKeeper) {
    console.warn(`Keeper key ${keeper.publicKey.toBase58()} isn't the config keeper — collecting fees only, no reward roots.`);
  }
  const status: KeeperStatus = {
    keeper: keeper.publicKey.toBase58(),
    lastTickAt: Date.now(),
    tokens: {},
    swapEnabled: isKeeper && CLUSTER === "mainnet-beta",
  };
  const mints = new Set((await listMetadata()).map((m) => m.mint));
  for (const m of (process.env.KEEPER_MINTS || "").split(",").map((x) => x.trim()).filter(Boolean)) mints.add(m);
  for (const m of mints) await processMint(new PublicKey(m), isKeeper, status);
  await saveKeeperStatus(status);
}

async function main() {
  console.log(`firepad keeper ${keeper.publicKey.toBase58()} · tick ${TICK_MS / 1000}s · epoch ${EPOCH_MS / 60_000}m`);
  for (;;) {
    const started = Date.now();
    await tick().catch((e) => console.error("tick failed:", e));
    await new Promise((r) => setTimeout(r, Math.max(1000, TICK_MS - (Date.now() - started))));
  }
}

main();
