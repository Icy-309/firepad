/**
 * Devnet end-to-end check of the FIREAGENT flow on the real pump.fun programs:
 *
 *   launch (create_v2 + fee sharing locked 50/50 creator/agent, one transaction)
 *   → a second wallet buys and sells → the agent distributes the creator fees
 *   → creator and agent each received half.
 *
 *   E2E_FUNDER=~/.config/solana/id.json FIREAGENT_KEYPAIR=~/.config/solana/fireagent.json \
 *     npx tsx scripts/fireagent-e2e.ts
 *
 * Uses a random mint (the program accepts any mint keypair, so a …fire one behaves
 * the same) to keep the vanity pool for real launches. Costs ~0.1 devnet SOL.
 */
import "./load-env";
import { readFileSync } from "fs";
import os from "os";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  clusterApiUrl,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, OnlinePumpSdk, PUMP_SDK } from "@pump-fun/pump-sdk";
import { buildLaunchInstructions, fetchLookupTable, packTransactions, readSplit } from "../lib/server/pump";

const expand = (p: string) => p.replace(/^~/, os.homedir());
const loadKp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expand(p), "utf8"))));

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const url = process.env.E2E_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(url, "confirmed");
  if ((await connection.getGenesisHash()) !== "EtWTRABZaYq6iMfeYKouRu166VU2x7v9hPL3YPG5d3J") {
    throw new Error("The end-to-end test only runs on Solana devnet. Set E2E_RPC_URL to a devnet endpoint.");
  }
  const sdk = new OnlinePumpSdk(connection);
  const creator = loadKp(process.env.E2E_FUNDER || "~/.config/solana/id.json");
  const agent = loadKp(process.env.FIREAGENT_KEYPAIR || "~/.config/solana/fireagent.json");
  const buyer = Keypair.generate();
  const mint = Keypair.generate();
  console.log("creator", creator.publicKey.toBase58(), "agent", agent.publicKey.toBase58(), "mint", mint.publicKey.toBase58());

  // Fund the buyer, and give the agent enough for its own transaction fees.
  const fund = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: buyer.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL })
  );
  if ((await connection.getBalance(agent.publicKey)) < 0.01 * LAMPORTS_PER_SOL) {
    fund.add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: agent.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL }));
  }
  await sendAndConfirmTransaction(connection, fund, [creator]);

  // 1) Launch exactly the way /api/launch/prepare builds it.
  const groups = await buildLaunchInstructions(connection, {
    mint: mint.publicKey,
    creator: creator.publicKey,
    agent: agent.publicKey,
    name: "Agent Test",
    symbol: "AGT",
    uri: "https://example.com/agt.json",
    buyLamports: BigInt(0.05 * LAMPORTS_PER_SOL),
  });
  const { blockhash } = await connection.getLatestBlockhash();
  const lookup = await fetchLookupTable(connection);
  const txs = packTransactions(groups, creator.publicKey, blockhash, lookup);
  console.log("launch transactions", txs.length, txs.map((t) => t.serialize().length), lookup ? "(with lookup table)" : "");
  for (const tx of txs) {
    const needed = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    tx.sign([creator, mint].filter((k) => needed.some((n) => n.equals(k.publicKey))));
    const sig = await connection.sendRawTransaction(tx.serialize());
    const conf = await connection.confirmTransaction(sig, "confirmed");
    if (conf.value.err) throw new Error(`launch tx failed: ${JSON.stringify(conf.value.err)} ${sig}`);
    console.log("  sent", sig);
  }
  check("launch: coin created with a first buy and fee sharing", true);

  const split = await readSplit(connection, mint.publicKey, agent.publicKey);
  check("split: 50/50 creator and agent", split.status === "active" && split.creator === creator.publicKey.toBase58(), JSON.stringify(split));
  check("split: locked", split.status === "active" && split.locked);

  // 2) Someone trades.
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig();
  const buyState = await sdk.fetchBuyState(mint.publicKey, buyer.publicKey, TOKEN_2022_PROGRAM_ID);
  const solAmount = new BN(0.2 * LAMPORTS_PER_SOL);
  const amount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: buyState.bondingCurve.tokenTotalSupply,
    bondingCurve: buyState.bondingCurve,
    amount: solAmount,
    quoteMint: NATIVE_MINT,
  });
  const buyIxs = await PUMP_SDK.buyV2Instructions({
    global,
    ...buyState,
    mint: mint.publicKey,
    user: buyer.publicKey,
    amount,
    quoteAmount: solAmount,
    slippage: 2,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ...buyIxs), [buyer]);
  check("buyer bought", true);

  const sellState = await sdk.fetchSellState(mint.publicKey, buyer.publicKey, TOKEN_2022_PROGRAM_ID);
  const sellAmount = amount.divn(2);
  const sellIxs = await PUMP_SDK.sellInstructions({
    global,
    bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
    bondingCurve: sellState.bondingCurve,
    mint: mint.publicKey,
    user: buyer.publicKey,
    amount: sellAmount,
    solAmount: getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: sellState.bondingCurve.tokenTotalSupply,
      bondingCurve: sellState.bondingCurve,
      amount: sellAmount,
    }),
    slippage: 2,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    mayhemMode: false,
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ...sellIxs), [buyer]);
  check("buyer sold half", true);

  // 3) The agent distributes.
  const min = await sdk.getMinimumDistributableFee(mint.publicKey, agent.publicKey, { payer: agent.publicKey });
  console.log("distributable", min.distributableFees.toString(), "minimum", min.minimumRequired.toString(), "can", min.canDistribute);
  check("fees are distributable", min.canDistribute);

  const before = await Promise.all([connection.getBalance(creator.publicKey), connection.getBalance(agent.publicKey)]);
  const { instructions } = await sdk.buildDistributeCreatorFeesInstructions(mint.publicKey, { payer: agent.publicKey });
  const distSig = await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [agent]);
  const tx = await connection.getTransaction(distSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const after = await Promise.all([connection.getBalance(creator.publicKey), connection.getBalance(agent.publicKey)]);
  const fee = tx?.meta?.fee ?? 0;
  const creatorGot = after[0] - before[0];
  const agentGot = after[1] - before[1] + fee;
  console.log("creator received", creatorGot, "agent received", agentGot, "tx fee", fee);
  check("creator received fees", creatorGot > 0);
  check("agent received the same half", agentGot > 0 && Math.abs(creatorGot - agentGot) <= 1, `${creatorGot} vs ${agentGot}`);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
