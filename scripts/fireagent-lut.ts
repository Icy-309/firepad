/**
 * Create the FIREAGENT address lookup table (optional, one time, ~0.004 SOL rent
 * paid by the agent wallet). With it, a launch with a first buy fits ONE atomic
 * transaction, so nobody can buy between creation and the creator's buy. Without
 * it, launches still work as 2–3 transactions approved in a single wallet popup.
 *
 *   FIREAGENT_KEYPAIR=~/.config/solana/fireagent.json npm run fireagent:lut
 *
 * Prints the table address; put it in FIREAGENT_LOOKUP_TABLE.
 */
import "./load-env";
import { readFileSync } from "fs";
import os from "os";
import {
  AddressLookupTableProgram,
  Connection,
  clusterApiUrl,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { buildLaunchInstructions } from "../lib/server/pump";

const expand = (p: string) => p.replace(/^~/, os.homedir());

/** Accounts every launch uses, whoever the creator and whatever the mint. */
async function staticKeys(connection: Connection, agent: PublicKey): Promise<PublicKey[]> {
  const sets = await Promise.all(
    [0, 1].map(async () => {
      const groups = await buildLaunchInstructions(connection, {
        mint: Keypair.generate().publicKey,
        creator: Keypair.generate().publicKey,
        agent,
        name: "x",
        symbol: "x",
        uri: "x",
        buyLamports: 10_000_000n,
      });
      const keys = new Map<string, PublicKey>();
      for (const ix of groups.flat()) {
        keys.set(ix.programId.toBase58(), ix.programId);
        for (const k of ix.keys) keys.set(k.pubkey.toBase58(), k.pubkey);
      }
      return keys;
    })
  );
  const shared = [...sets[0].entries()].filter(([k]) => sets[1].has(k)).map(([, v]) => v);
  // Fee recipients are picked at random per trade, so list all of them.
  const global = await new OnlinePumpSdk(connection).fetchGlobal();
  const extra = [global.feeRecipient, ...global.feeRecipients, ...global.buybackFeeRecipients];
  const seen = new Set(shared.map((k) => k.toBase58()));
  return [...shared, ...extra.filter((k) => !k.equals(PublicKey.default) && !seen.has(k.toBase58()) && seen.add(k.toBase58()))];
}

async function main() {
  const url = process.env.RPC_URL || clusterApiUrl("mainnet-beta");
  const connection = new Connection(url, "confirmed");
  if ((await connection.getGenesisHash()) !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") {
    throw new Error("Configured Solana RPC is not connected to mainnet-beta.");
  }
  const agent = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(expand(process.env.FIREAGENT_KEYPAIR || "~/.config/solana/fireagent.json"), "utf8")))
  );
  const keys = await staticKeys(connection, agent.publicKey);
  console.log(`${keys.length} shared accounts`);

  const slot = await connection.getSlot("finalized");
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: agent.publicKey, payer: agent.publicKey, recentSlot: slot });
  await sendAndConfirmTransaction(connection, new Transaction().add(create), [agent]);
  for (let i = 0; i < keys.length; i += 20) {
    const extend = AddressLookupTableProgram.extendLookupTable({
      lookupTable: table,
      authority: agent.publicKey,
      payer: agent.publicKey,
      addresses: keys.slice(i, i + 20),
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(extend), [agent]);
  }
  console.log(`\nFIREAGENT_LOOKUP_TABLE=${table.toBase58()}`);
  console.log("It becomes usable about one slot after the last extend.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
