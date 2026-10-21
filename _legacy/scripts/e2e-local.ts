/**
 * End-to-end test of the on-chain program through the app's own client (lib/program.ts).
 *
 *   Local:   solana-test-validator --reset --bpf-program <PROGRAM_ID> anchor/target/deploy/firepad.so
 *            NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/e2e-local.ts
 *   Devnet:  E2E_FUNDER=~/.config/solana/id.json NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com \
 *            npx tsx scripts/e2e-local.ts
 *
 * With E2E_FUNDER set, test wallets are funded by transfer from that keypair (small
 * amounts, ~0.4 SOL total) instead of airdrops, and the deployed config is reused
 * if it already exists (the funder must then be the config's keeper).
 *
 * Flow: initialize → create coin → two buys → wallet-to-wallet transfer → sell →
 * harvest + collect fees (50/50 split) → rewards root → holder claim (+ double-claim
 * rejected) → creator claim. Prints PASS/FAIL per check; exits 1 on any failure.
 */
import { readFileSync } from "fs";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ata2022,
  buyIx,
  claimCreatorFeesIx,
  claimRewardsIx,
  collectFeesIx,
  createTokenIx,
  creatorVaultPda,
  decodeMintFee,
  decodeMintMetadata,
  decodeTokenAccount,
  decodeTokenAmount,
  fetchConfig,
  fetchTokenStates,
  harvestToMintIx,
  initializeIx,
  rewardVaultPda,
  sellIx,
  setRewardsRootIx,
  TOKEN_2022_PROGRAM_ID,
  tokenStatePda,
} from "../lib/program";
import { buildTree, proofFor } from "../lib/merkle";

const RPC = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
const connection = new Connection(RPC, "confirmed");
const FUNDER = process.env.E2E_FUNDER
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.E2E_FUNDER.replace(/^~/, process.env.USERPROFILE || process.env.HOME || ""), "utf8"))))
  : null;
// Trade sizes: generous locally, small on devnet.
const BUY_A = FUNDER ? 0.06 : 1;
const BUY_B = FUNDER ? 0.03 : 0.5;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function send(signers: Keypair[], ...ixs: TransactionInstruction[]) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
  return sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
}

async function expectFail(name: string, p: Promise<unknown>, contains: string) {
  try {
    await p;
    check(name, false, "succeeded but should have failed");
  } catch (e) {
    const msg = String((e as { logs?: string[] }).logs?.join("\n") ?? (e as Error).message);
    check(name, msg.includes(contains), msg.includes(contains) ? `rejected: ${contains}` : msg.slice(0, 300));
  }
}

async function fund(...wallets: [Keypair, number][]) {
  if (FUNDER) {
    const ixs = wallets.map(([kp, sol]) =>
      SystemProgram.transfer({ fromPubkey: FUNDER.publicKey, toPubkey: kp.publicKey, lamports: Math.round(sol * LAMPORTS_PER_SOL) })
    );
    await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [FUNDER], { commitment: "confirmed" });
    return;
  }
  for (const [kp] of wallets) {
    const sig = await connection.requestAirdrop(kp.publicKey, 20 * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  }
}

/** Token-2022 CreateIdempotent ATA + TransferChecked (the fee is withheld in the destination). */
function createAtaIx(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata2022(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}
function transferCheckedIx(from: PublicKey, mint: PublicKey, to: PublicKey, owner: PublicKey, amount: bigint, decimals: number) {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(amount, 1);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

const balance = async (owner: PublicKey, mint: PublicKey) =>
  decodeTokenAmount((await connection.getAccountInfo(ata2022(owner, mint)))?.data);
const state = async (mint: PublicKey) => (await fetchTokenStates(connection, [mint])).get(mint.toBase58())!;

async function main() {
  console.log(`RPC ${RPC}\n`);
  // The config is global: on devnet the funder initializes it (once) and is authority + keeper.
  const authority = FUNDER ?? Keypair.generate();
  const creator = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  if (FUNDER) await fund([creator, 0.1], [alice, BUY_A + 0.05], [bob, BUY_B + 0.05]);
  else await fund([authority, 20], [creator, 20], [alice, 20], [bob, 20]);

  // 1) initialize (or reuse an existing config)
  let config = await fetchConfig(connection);
  if (!config) {
    await send([authority], initializeIx(authority.publicKey, 100, authority.publicKey));
    config = await fetchConfig(connection);
    check("initialize: config readable by client", !!config && config.feeBps === 100 && config.keeper.equals(authority.publicKey));
  } else {
    check("config: already initialized, funder is keeper", config.keeper.equals(authority.publicKey), `keeper ${config.keeper.toBase58()}`);
    if (!config.keeper.equals(authority.publicKey)) throw new Error("E2E_FUNDER must be the config keeper");
  }
  const feeBps = config!.feeBps;

  // 2) create coin
  // Same shape as the create page: create_token + the creator's initial buy in ONE transaction.
  const devBuy = BigInt(Math.round((FUNDER ? 0.02 : 0.5) * LAMPORTS_PER_SOL));
  const createTx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }))
    .add(createTokenIx(creator.publicKey, mint, { name: "Test Fire", symbol: "TFIRE", uri: "https://example.com/meta.json" }))
    .add(buyIx(creator.publicKey, mint, devBuy, 1n));
  await sendAndConfirmTransaction(connection, createTx, [creator, mintKp], { commitment: "confirmed" });
  check("create + initial buy in one tx: creator holds tokens", (await balance(creator.publicKey, mint)) > 0n, `${await balance(creator.publicKey, mint)} raw`);
  let ts = await state(mint);
  check("create_token: TokenState decodes", !!ts && ts.creator.equals(creator.publicKey) && !ts.complete);
  const mintInfo = await connection.getAccountInfo(mint);
  const meta = mintInfo && decodeMintMetadata(mintInfo.data);
  check("create_token: on-chain metadata", meta?.name === "Test Fire" && meta?.symbol === "TFIRE", JSON.stringify(meta));
  const fee = mintInfo && decodeMintFee(mintInfo.data);
  check(`create_token: transfer fee = ${feeBps} bps`, fee?.feeBps === feeBps, JSON.stringify(fee, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

  // 3) buys
  await send([alice], buyIx(alice.publicKey, mint, BigInt(Math.round(BUY_A * LAMPORTS_PER_SOL)), 0n));
  await send([bob], buyIx(bob.publicKey, mint, BigInt(Math.round(BUY_B * LAMPORTS_PER_SOL)), 0n));
  const aBal = await balance(alice.publicKey, mint);
  const bBal = await balance(bob.publicKey, mint);
  check("buy: both wallets got tokens", aBal > 0n && bBal > 0n, `alice ${aBal}, bob ${bBal}`);
  check("buy: alice (2x SOL) got more than bob", aBal > bBal);

  // 4) wallet-to-wallet transfer (fee withheld at the destination)
  const sendAmt = aBal / 10n;
  await send([alice], transferCheckedIx(ata2022(alice.publicKey, mint), mint, ata2022(bob.publicKey, mint), alice.publicKey, sendAmt, 6));
  const bAfter = await balance(bob.publicKey, mint);
  // Token-2022 rounds the fee up: ceil(amount * bps / 10000).
  const expectFee = (sendAmt * BigInt(feeBps) + 9999n) / 10000n;
  check(`transfer: bob received amount minus ${feeBps} bps fee`, bAfter - bBal === sendAmt - expectFee, `+${bAfter - bBal} of ${sendAmt}`);

  // 5) sell
  const solBefore = await connection.getBalance(bob.publicKey);
  await send([bob], sellIx(bob.publicKey, mint, bAfter / 2n, 0n));
  check("sell: bob received SOL", (await connection.getBalance(bob.publicKey)) > solBefore - 10_000);

  // 6) harvest + collect fees → 50/50
  // The public RPC refuses getProgramAccounts on Token-2022, so check the accounts we know about.
  const known = [alice.publicKey, bob.publicKey, tokenStatePda(mint)].map((o) => ata2022(o, mint));
  const infos = await connection.getMultipleAccountsInfo(known);
  const withheld = infos
    .map((info, i) => (info ? { pk: known[i], ...decodeTokenAccount(info.data) } : null))
    .filter((a): a is NonNullable<typeof a> => !!a && a.withheld > 0n);
  check("fees: withheld in token accounts", withheld.length > 0, `${withheld.length} accounts`);
  await send([authority], harvestToMintIx(mint, withheld.map((a) => a.pk)));
  const cvBefore = await connection.getBalance(creatorVaultPda(mint));
  const rvBefore = await connection.getBalance(rewardVaultPda(mint));
  await send([authority], collectFeesIx(authority.publicKey, mint));
  const cvGain = (await connection.getBalance(creatorVaultPda(mint))) - cvBefore;
  const rvGain = (await connection.getBalance(rewardVaultPda(mint))) - rvBefore;
  check("collect_fees: SOL to both vaults", cvGain > 0 && rvGain > 0, `creator +${cvGain}, holders +${rvGain}`);
  check("collect_fees: split is 50/50 (±1 lamport)", Math.abs(cvGain - rvGain) <= 1);
  await expectFail("collect_fees: nothing left → rejected", send([authority], collectFeesIx(authority.publicKey, mint)), "NothingToCollect");

  // 7) rewards root + claims
  ts = await state(mint);
  const aNow = await balance(alice.publicKey, mint);
  const bNow = await balance(bob.publicKey, mint);
  const total = ts.holderFeesTotal;
  const nextEpoch = ts.rewardsEpoch + 1;
  const aShare = (total * aNow) / (aNow + bNow);
  const allocations = { [alice.publicKey.toBase58()]: aShare, [bob.publicKey.toBase58()]: total - aShare };
  const tree = buildTree(allocations)!;
  await expectFail(
    "set_rewards_root: over-allocating rejected",
    send([authority], setRewardsRootIx(authority.publicKey, mint, tree.root, total + 1n, nextEpoch)),
    "BadRewardsRoot"
  );
  await expectFail(
    "set_rewards_root: non-keeper rejected",
    send([alice], setRewardsRootIx(alice.publicKey, mint, tree.root, total, nextEpoch)),
    "NotKeeper"
  );
  await send([authority], setRewardsRootIx(authority.publicKey, mint, tree.root, total, nextEpoch));
  // Alice's wallet delta also includes the one-time claim-status rent, which can exceed a
  // tiny test reward, so measure the payout at the reward vault instead.
  const rvA = await connection.getBalance(rewardVaultPda(mint));
  await send([alice], claimRewardsIx(alice.publicKey, mint, aShare, proofFor(tree, alice.publicKey.toBase58())!));
  const paidA = rvA - (await connection.getBalance(rewardVaultPda(mint)));
  check("claim_rewards: reward vault paid alice exactly her share", BigInt(paidA) === aShare, `${paidA} of ${aShare}`);
  await expectFail(
    "claim_rewards: double claim rejected",
    send([alice], claimRewardsIx(alice.publicKey, mint, aShare, proofFor(tree, alice.publicKey.toBase58())!)),
    "NothingToClaim"
  );
  await expectFail(
    "claim_rewards: inflated amount rejected",
    send([bob], claimRewardsIx(bob.publicKey, mint, total, proofFor(tree, bob.publicKey.toBase58())!)),
    "InvalidProof"
  );

  // 8) creator fees
  ts = await state(mint);
  const owed = ts.creatorFeesOwed;
  const solC = await connection.getBalance(creator.publicKey);
  await send([creator], claimCreatorFeesIx(creator.publicKey, mint));
  const gainedC = (await connection.getBalance(creator.publicKey)) - solC;
  check("claim_creator_fees: creator paid", owed > 0n && gainedC > 0, `+${gainedC} of ${owed}`);
  await expectFail("claim_creator_fees: non-creator rejected", send([alice], claimCreatorFeesIx(alice.publicKey, mint)), "Error");

  console.log(`\nTest coin: ${mint.toBase58()}`);
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("CRASH", e?.logs ?? e);
  process.exit(1);
});
