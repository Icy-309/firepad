/**
 * Cumulative-rewards merkle tree, hashed exactly like rewards.rs:
 *   leaf = sha256(0x00 ‖ wallet(32) ‖ cumulative_u64_le)
 *   node = sha256(0x01 ‖ min(a, b) ‖ max(a, b))   (byte-wise comparison)
 * The 0x00/0x01 prefixes stop an inner node from being passed off as a leaf.
 */
import { sha256 } from "@noble/hashes/sha2";
import { PublicKey } from "@solana/web3.js";

export type Hash = Uint8Array;

function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function compare(a: Hash, b: Hash): number {
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export const leafHash = (wallet: string, cumulative: bigint): Hash =>
  sha256(concat(new Uint8Array([0]), new PublicKey(wallet).toBytes(), u64le(cumulative)));

export const nodeHash = (a: Hash, b: Hash): Hash =>
  compare(a, b) <= 0 ? sha256(concat(new Uint8Array([1]), a, b)) : sha256(concat(new Uint8Array([1]), b, a));

export interface RewardsTree {
  root: Hash;
  /** levels[0] = leaves (sorted by wallet for determinism), last = [root]. */
  levels: Hash[][];
  index: Map<string, number>;
}

/** Build the tree over every wallet's cumulative allocation (an odd node is promoted as-is). */
export function buildTree(allocations: Record<string, bigint>): RewardsTree | null {
  const wallets = Object.keys(allocations)
    .filter((w) => allocations[w] > 0n)
    .sort();
  if (!wallets.length) return null;
  const levels: Hash[][] = [wallets.map((w) => leafHash(w, allocations[w]))];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Hash[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? nodeHash(prev[i], prev[i + 1]) : prev[i]);
    levels.push(next);
  }
  return { root: levels[levels.length - 1][0], levels, index: new Map(wallets.map((w, i) => [w, i])) };
}

export function proofFor(tree: RewardsTree, wallet: string): Hash[] | null {
  let i = tree.index.get(wallet);
  if (i === undefined) return null;
  const proof: Hash[] = [];
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const level = tree.levels[l];
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]);
    i = Math.floor(i / 2);
  }
  return proof;
}

/** Same check the program runs. */
export function verifyProof(root: Hash, wallet: string, cumulative: bigint, proof: Hash[]): boolean {
  let node = leafHash(wallet, cumulative);
  for (const p of proof) node = nodeHash(node, p);
  return compare(node, root) === 0;
}

export const toHex = (h: Hash) => Buffer.from(h).toString("hex");
export const fromHex = (s: string): Hash => Uint8Array.from(Buffer.from(s, "hex"));
