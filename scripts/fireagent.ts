/**
 * FIREAGENT — pays holders their half of every connected coin's creator fees.
 *
 *   npm run fireagent
 *
 * pump.fun splits each connected coin's creator fee 50/50 between the creator and
 * this agent's wallet (a locked pump-fees sharing config). Every tick, per coin:
 *
 *   1. Distribute: once pump.fun says enough fees have built up, crank
 *      distribute_creator_fees. pump.fun pays the creator's half straight to the
 *      creator and the other half to this wallet. The half we receive (measured
 *      from the transaction's own balance changes) is credited to that coin's
 *      holder pool.
 *   2. Pay holders: once a coin's pool reaches FIREAGENT_MIN_PAYOUT_SOL, snapshot
 *      its holders and send each their share by balance, in batches of plain SOL
 *      transfers. Network fees for the payout come out of the pool. The pool is
 *      reduced after every confirmed batch, so a crash never pays anyone twice.
 *
 * Who counts as a holder: wallets (on-curve addresses) holding at least
 * FIREAGENT_MIN_HOLD_PCT of the supply, except the creator (already paid by pump.fun)
 * and the agent. Smaller wallets' part goes to the eligible holders, by balance. Program-owned accounts
 * (the bonding curve, AMM pools, vaults) are off-curve and so never paid.
 *
 * Env: FIREAGENT_KEYPAIR (solana-keygen JSON; its address is NEXT_PUBLIC_FIREAGENT_WALLET),
 * RPC_URL (needs getProgramAccounts on the token programs: Helius / Triton / QuickNode),
 * FIREAGENT_TICK_SECONDS (120), FIREAGENT_MIN_PAYOUT_SOL (0.05),
 * FIREAGENT_MAX_HOLDERS (200), FIREAGENT_MIN_SHARE_SOL (0.0001),
 * FIREAGENT_MIN_HOLD_PCT (0.1).
 */
import "./load-env"; // must be first: loads .env.local before anything reads process.env
import { readFileSync } from "fs";
import os from "os";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assertMainnetConnection, connection } from "../lib/server/connection";
import { listCoins, saveCoin, type CoinRecord } from "../lib/server/fireagent-store";
import { pumpSdk, readSplit } from "../lib/server/pump";
import { decodeTokenAccount } from "../lib/token-meta";

const TICK_MS = Number(process.env.FIREAGENT_TICK_SECONDS || 120) * 1000;
const MIN_PAYOUT = Math.round(Number(process.env.FIREAGENT_MIN_PAYOUT_SOL || 0.05) * LAMPORTS_PER_SOL);
const MAX_HOLDERS = Number(process.env.FIREAGENT_MAX_HOLDERS || 200);
const MIN_SHARE = Math.round(Number(process.env.FIREAGENT_MIN_SHARE_SOL || 0.0001) * LAMPORTS_PER_SOL);
/** Minimum holding to be paid, as a % of the coin's supply, in millionths of a percent. */
const MIN_HOLD_MICROPCT = BigInt(Math.round(Number(process.env.FIREAGENT_MIN_HOLD_PCT ?? 0.1) * 1e6));
const TRANSFERS_PER_TX = 18;
const TX_FEE = 5_000;
const PRIORITY_MICROLAMPORTS = Number(process.env.FIREAGENT_PRIORITY_MICROLAMPORTS || 0);

const expand = (p: string) => p.replace(/^~/, os.homedir());

function loadAgent(): Keypair {
  const file = process.env.FIREAGENT_KEYPAIR;
  if (!file) throw new Error("Set FIREAGENT_KEYPAIR to the agent wallet's keypair file");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expand(file), "utf8"))));
  const pub = process.env.NEXT_PUBLIC_FIREAGENT_WALLET;
  if (pub && pub !== kp.publicKey.toBase58()) {
    throw new Error(`FIREAGENT_KEYPAIR is ${kp.publicKey.toBase58()} but NEXT_PUBLIC_FIREAGENT_WALLET is ${pub}`);
  }
  return kp;
}

const log = (mint: string, msg: string) => console.log(`[${new Date().toISOString()}] ${mint.slice(0, 6)}… ${msg}`);
const sol = (l: number) => `${(l / LAMPORTS_PER_SOL).toFixed(6)} SOL`;

function withBudget(tx: Transaction) {
  if (PRIORITY_MICROLAMPORTS > 0) {
    tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }));
  }
  return tx;
}

/** Step 1. Returns lamports credited to the holder pool. */
async function distribute(agent: Keypair, coin: CoinRecord): Promise<number> {
  const sdk = pumpSdk(connection);
  const mint = new PublicKey(coin.mint);
  const min = await sdk.getMinimumDistributableFee(mint, agent.publicKey, { payer: agent.publicKey });
  if (!min.canDistribute) return 0;

  const { instructions } = await sdk.buildDistributeCreatorFeesInstructions(mint, { payer: agent.publicKey });
  const sig = await sendAndConfirmTransaction(connection, withBudget(new Transaction().add(...instructions)), [agent], {
    commitment: "confirmed",
  });
  // What actually arrived: the agent's balance change in this transaction, plus the fee it paid.
  const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx?.meta) throw new Error(`distribution ${sig} confirmed but its details are unavailable`);
  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const i = keys.findIndex((k) => k.equals(agent.publicKey));
  const received = tx.meta.postBalances[i] - tx.meta.preBalances[i] + tx.meta.fee;
  log(coin.mint, `distributed, agent half ${sol(received)} (${sig})`);
  return Math.max(0, received);
}

/** Wallet holders of `mint` with at least MIN_HOLD_PCT of supply: owner → raw balance (largest first, capped). */
async function snapshotHolders(mint: PublicKey, exclude: Set<string>): Promise<{ owner: PublicKey; amount: bigint }[]> {
  const info = await connection.getAccountInfo(mint);
  if (!info) return [];
  // SPL mint layout (both token programs): supply is a u64 at offset 36.
  const supply = info.data.readBigUInt64LE(36);
  const minAmount = (supply * MIN_HOLD_MICROPCT) / 100_000_000n;
  const accounts = await connection.getProgramAccounts(info.owner, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
    dataSlice: { offset: 0, length: 72 },
  });
  const byOwner = new Map<string, bigint>();
  for (const { account } of accounts) {
    if (account.data.length < 72) continue;
    const { owner, amount } = decodeTokenAccount(account.data);
    if (amount === 0n) continue;
    const key = owner.toBase58();
    if (exclude.has(key) || !PublicKey.isOnCurve(owner.toBytes())) continue;
    byOwner.set(key, (byOwner.get(key) ?? 0n) + amount);
  }
  return [...byOwner.entries()]
    .filter(([, amount]) => amount >= minAmount)
    .map(([owner, amount]) => ({ owner: new PublicKey(owner), amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .slice(0, MAX_HOLDERS);
}

/** Split `pool` by balance; drop shares under MIN_SHARE and re-split among the rest. */
function shares(holders: { owner: PublicKey; amount: bigint }[], pool: number) {
  let list = holders;
  for (;;) {
    const total = list.reduce((n, h) => n + h.amount, 0n);
    if (total === 0n) return [];
    const out = list.map((h) => ({ owner: h.owner, lamports: Number((BigInt(pool) * h.amount) / total) }));
    const kept = out.filter((s) => s.lamports >= MIN_SHARE);
    if (kept.length === out.length) return out;
    if (!kept.length) return [];
    list = list.filter((h) => kept.some((k) => k.owner.equals(h.owner)));
  }
}

/** Step 2. */
async function payHolders(agent: Keypair, coin: CoinRecord) {
  const mint = new PublicKey(coin.mint);
  const holders = await snapshotHolders(mint, new Set([coin.creator, agent.publicKey.toBase58()]));
  coin.holders = holders.length;
  const batches = Math.ceil(holders.length / TRANSFERS_PER_TX);
  const budget = coin.holderPoolLamports - batches * TX_FEE;
  let list = shares(holders, budget);
  if (!list.length) {
    log(coin.mint, `pool ${sol(coin.holderPoolLamports)}: no holder share reaches the minimum yet`);
    return;
  }

  // A transfer that leaves a brand-new wallet below rent-exemption fails; skip those.
  const rentMin = await connection.getMinimumBalanceForRentExemption(0);
  const infos = await connection.getMultipleAccountsInfo(list.map((s) => s.owner));
  list = list.filter((s, i) => (infos[i]?.lamports ?? 0) + s.lamports >= rentMin);

  const payout = { at: Date.now(), lamports: 0, recipients: 0, signatures: [] as string[] };
  for (let i = 0; i < list.length; i += TRANSFERS_PER_TX) {
    const batch = list.slice(i, i + TRANSFERS_PER_TX);
    const tx = withBudget(
      new Transaction().add(
        ...batch.map((s) => SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: s.owner, lamports: s.lamports }))
      )
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [agent], { commitment: "confirmed" });
    const paid = batch.reduce((n, s) => n + s.lamports, 0);
    payout.lamports += paid;
    payout.recipients += batch.length;
    payout.signatures.push(sig);
    // Book every confirmed batch before the next one, so a crash can't pay it twice.
    coin.holderPoolLamports -= paid + TX_FEE;
    coin.holderPaidLamports += paid;
    coin.payoutFeesLamports += TX_FEE;
    coin.lastPayoutAt = payout.at;
    coin.payouts = [payout, ...coin.payouts.filter((p) => p !== payout)];
    await saveCoin(coin);
  }
  log(coin.mint, `paid ${sol(payout.lamports)} to ${payout.recipients} holders`);
}

async function tickCoin(agent: Keypair, coin: CoinRecord) {
  const split = await readSplit(connection, new PublicKey(coin.mint), agent.publicKey);
  if (split.status !== "active") {
    if (coin.inactive !== split.status) {
      coin.inactive = split.status;
      await saveCoin(coin);
      log(coin.mint, `split is "${split.status}", skipping`);
    }
    return;
  }
  if (coin.inactive) delete coin.inactive;

  const received = await distribute(agent, coin).catch((e) => {
    log(coin.mint, `distribute failed: ${(e as Error).message}`);
    return 0;
  });
  if (received > 0) {
    coin.holderPoolLamports += received;
    coin.distributedLamports += received * 2;
    coin.lastDistributeAt = Date.now();
    await saveCoin(coin);
  }

  if (coin.holderPoolLamports >= MIN_PAYOUT) await payHolders(agent, coin);
}

async function tick(agent: Keypair) {
  const coins = await listCoins();
  for (const coin of coins) {
    try {
      await tickCoin(agent, coin);
    } catch (e) {
      log(coin.mint, `error: ${(e as Error).message}`);
    }
  }
}

async function main() {
  await assertMainnetConnection();
  const agent = loadAgent();
  const balance = await connection.getBalance(agent.publicKey);
  console.log(`FIREAGENT ${agent.publicKey.toBase58()} · balance ${sol(balance)} · tick ${TICK_MS / 1000}s`);
  if (balance < 0.002 * LAMPORTS_PER_SOL) {
    console.log("Low balance: the agent pays ~0.000005 SOL per transaction until its first distribution arrives.");
  }
  const once = process.argv.includes("--once");
  for (;;) {
    await tick(agent).catch((e) => console.error("[tick]", e));
    if (once) break;
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
