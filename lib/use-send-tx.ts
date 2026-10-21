"use client";

import { useCallback } from "react";
import { type Keypair, type Transaction, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

export class SimulationError extends Error {
  constructor(message: string, readonly logs: string[]) {
    super(message);
  }
}

/**
 * Sign-then-send, the way most launchpads do it:
 *   1. simulate through our RPC, so a failing transaction shows a real error right away
 *      instead of leaving the wallet popup spinning;
 *   2. ask the wallet only to *sign* (it doesn't need its own network connection to be
 *      healthy, or even set to the right cluster, for that);
 *   3. send and confirm through our RPC.
 * Falls back to the wallet's own send for wallets that can't sign without sending.
 */
export function useSendTx() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();

  return useCallback(
    async (
      tx: Transaction,
      opts: { signers?: Keypair[]; onApprove?: () => void; onSent?: (sig: string) => void } = {}
    ): Promise<string> => {
      if (!publicKey) throw new Error("Connect a wallet first");
      const latest = await connection.getLatestBlockhash("confirmed");
      tx.feePayer = publicKey;
      tx.recentBlockhash = latest.blockhash;

      const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      });
      if (sim.value.err) {
        const logs = sim.value.logs ?? [];
        const anchorMsg = logs.map((l) => /Error Message: (.*)$/.exec(l)?.[1]).find(Boolean);
        const lowFunds = logs.some((l) => /insufficient lamports|insufficient funds/i.test(l)) || JSON.stringify(sim.value.err).includes("InsufficientFunds");
        throw new SimulationError(
          lowFunds ? "Not enough SOL in your wallet for this transaction." : anchorMsg || `Transaction would fail: ${JSON.stringify(sim.value.err)}`,
          logs
        );
      }

      if (opts.signers?.length) tx.partialSign(...opts.signers);
      opts.onApprove?.();

      let sig: string;
      if (signTransaction) {
        const signed = await signTransaction(tx);
        sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 5 });
      } else {
        sig = await sendTransaction(tx, connection, { signers: opts.signers });
      }
      opts.onSent?.(sig);

      const conf = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
      if (conf.value.err) throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);
      return sig;
    },
    [connection, publicKey, signTransaction, sendTransaction]
  );
}

/**
 * Send transactions the server built (base64, possibly already co-signed, e.g. by a
 * mint key). Only the first is simulated: later ones depend on it landing. The
 * wallet signs them all in one approval when it can, then they go out in order,
 * each confirmed before the next.
 */
export function useSendPrepared() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();

  return useCallback(
    async (
      prepared: { transactions: string[]; lastValidBlockHeight: number },
      opts: { onApprove?: () => void; onSent?: (sig: string, index: number) => void } = {}
    ): Promise<string[]> => {
      const encoded = prepared.transactions;
      if (!publicKey || !signTransaction) throw new Error("Connect a wallet that can sign transactions");
      const txs = encoded.map((b) => VersionedTransaction.deserialize(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))));

      const sim = await connection.simulateTransaction(txs[0], { sigVerify: false, commitment: "confirmed" });
      if (sim.value.err) {
        const logs = sim.value.logs ?? [];
        const anchorMsg = logs.map((l) => /Error Message: (.*)$/.exec(l)?.[1]).find(Boolean);
        const lowFunds = logs.some((l) => /insufficient lamports|insufficient funds/i.test(l)) || JSON.stringify(sim.value.err).includes("InsufficientFunds");
        throw new SimulationError(
          lowFunds ? "Not enough SOL in your wallet for this transaction." : anchorMsg || `Transaction would fail: ${JSON.stringify(sim.value.err)}`,
          logs
        );
      }

      opts.onApprove?.();
      const signed = signAllTransactions && txs.length > 1 ? await signAllTransactions(txs) : [];
      const sigs: string[] = [];
      for (let i = 0; i < txs.length; i++) {
        const tx = signed[i] ?? (await signTransaction(txs[i]));
        const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: i > 0, maxRetries: 5 });
        opts.onSent?.(sig, i);
        const conf = await connection.confirmTransaction(
          { signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: prepared.lastValidBlockHeight },
          "confirmed"
        );
        if (conf.value.err) throw new Error(`Transaction ${i + 1} of ${txs.length} failed: ${JSON.stringify(conf.value.err)}`);
        sigs.push(sig);
      }
      return sigs;
    },
    [connection, publicKey, signTransaction, signAllTransactions]
  );
}
