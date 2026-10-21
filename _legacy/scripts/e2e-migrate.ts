/**
 * Devnet test of program-controlled graduation (`migrate` → Raydium CPMM + LP burn).
 *
 *   E2E_FUNDER=~/.config/solana/id.json npx tsx scripts/e2e-migrate.ts
 *
 * The funder must be the config authority. To avoid spending ~85 SOL, it temporarily
 * switches the config to a tiny curve (sells out for ~0.6 SOL), launches a coin and buys
 * the whole curve in one transaction, migrates it, checks the pool, then ALWAYS restores
 * the pump.fun curve.
 */
import "./load-env";
import { readFileSync } from "fs";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import {
  buyIx,
  createTokenIx,
  creatorVaultPda,
  fetchConfig,
  fetchTokenStates,
  migrateTx,
  PUMP_FUN_CURVE,
  RAYDIUM,
  raydiumPool,
  rewardVaultPda,
  updateConfigIx,
  type CurveParams,
} from "../lib/program";

const connection = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
const funderPath = (process.env.E2E_FUNDER || "~/.config/solana/id.json").replace(/^~/, process.env.USERPROFILE || process.env.HOME || "");
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(funderPath, "utf8"))));

// Same as pump.fun but only 2% of the virtual tokens are sellable: sells out for ~0.61 SOL.
const TEST_CURVE: CurveParams = {
  ...PUMP_FUN_CURVE,
  initialRealTokenReserves: PUMP_FUN_CURVE.initialVirtualTokenReserves / 50n,
};

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const send = (tx: Transaction, signers: Keypair[]) => sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
const u64At = (d: Buffer, o: number) => d.readBigUInt64LE(o);

async function main() {
  const config = await fetchConfig(connection);
  if (!config?.authority.equals(funder.publicKey)) throw new Error("E2E_FUNDER must be the config authority");
  console.log(`Raydium CPMM ${RAYDIUM.cpmm.toBase58()}\n`);

  await send(new Transaction().add(updateConfigIx(funder.publicKey, { curve: TEST_CURVE })), [funder]);
  try {
    // 1) Launch + buy out the whole curve in one transaction.
    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey;
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }))
      .add(createTokenIx(funder.publicKey, mint, { name: "Grad Test", symbol: "GRAD", uri: "https://example.com/g.json" }))
      .add(buyIx(funder.publicKey, mint, BigInt(1 * LAMPORTS_PER_SOL), 1n));
    await send(tx, [funder, mintKp]);
    let ts = (await fetchTokenStates(connection, [mint])).get(mint.toBase58())!;
    check("curve sold out → complete", ts.complete, `${Number(ts.realSolReserves) / 1e9} SOL raised`);
    check("not migrated yet", !ts.migrated);
    const holdersBefore = ts.holderFeesTotal;
    const cvBefore = await connection.getBalance(creatorVaultPda(mint));
    const rvBefore = await connection.getBalance(rewardVaultPda(mint));

    // 2) Migrate (anyone can call; here the funder).
    try {
      const sig = await send(migrateTx(funder.publicKey, mint), [funder]);
      const done = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
      console.log("      " + (done?.meta?.logMessages?.find((l) => l.includes("MIGRATED")) ?? "").replace("Program log: ", ""));
      console.log(`      compute used: ${done?.meta?.computeUnitsConsumed}`);
    } catch (e) {
      console.error("migrate failed:", (e as { logs?: string[] }).logs?.slice(-25).join("\n") ?? e);
      throw e;
    }

    // 3) Checks.
    ts = (await fetchTokenStates(connection, [mint])).get(mint.toBase58())!;
    check("token marked migrated", ts.migrated && ts.realSolReserves === 0n);
    const p = raydiumPool(mint);
    const pool = await connection.getAccountInfo(p.pool);
    check("Raydium pool exists", !!pool && pool.owner.equals(RAYDIUM.cpmm), p.pool.toBase58());
    const lpMint = await connection.getAccountInfo(p.lpMint);
    const lpSupply = lpMint ? u64At(lpMint.data, 36) : -1n;
    check("all LP tokens burned (LP supply = 0)", lpSupply === 0n, `supply ${lpSupply}`);
    const [v0, v1] = await connection.getMultipleAccountsInfo([p.vault0, p.vault1]);
    const amt0 = v0 ? u64At(v0.data, 64) : 0n;
    const amt1 = v1 ? u64At(v1.data, 64) : 0n;
    const [solAmt, tokAmt] = p.wsolFirst ? [amt0, amt1] : [amt1, amt0];
    check("pool holds SOL and tokens", solAmt > 0n && tokAmt > 0n, `${Number(solAmt) / 1e9} SOL + ${Number(tokAmt) / 1e6} tokens`);
    const cvGain = (await connection.getBalance(creatorVaultPda(mint))) - cvBefore;
    const rvGain = (await connection.getBalance(rewardVaultPda(mint))) - rvBefore;
    check("unspent reserve split 50/50 to creator/holders", cvGain > 0 && Math.abs(cvGain - rvGain) <= 1, `creator +${cvGain}, holders +${rvGain}`);
    check("holder pool accounting updated", ts.holderFeesTotal - holdersBefore === BigInt(rvGain));
    try {
      await send(migrateTx(funder.publicKey, mint), [funder]);
      check("second migrate rejected", false, "succeeded");
    } catch (e) {
      const logs = (e as { logs?: string[] }).logs?.join("\n") ?? String(e);
      check("second migrate rejected", logs.includes("AlreadyMigrated"), logs.includes("AlreadyMigrated") ? "AlreadyMigrated" : logs.slice(0, 200));
    }
    console.log(`\nCoin: ${mint.toBase58()}\nPool: ${p.pool.toBase58()}`);
  } finally {
    await send(new Transaction().add(updateConfigIx(funder.publicKey, { curve: PUMP_FUN_CURVE })), [funder]);
    const back = await fetchConfig(connection);
    check("pump.fun curve restored", back?.curve.initialRealTokenReserves === PUMP_FUN_CURVE.initialRealTokenReserves);
  }
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("CRASH", e?.logs ?? e);
  process.exit(1);
});
