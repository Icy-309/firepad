import BN from "bn.js";
import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  type Connection,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  bondingCurvePda,
  canonicalPumpPoolPda,
  feeSharingConfigPda,
  getBuyTokenAmountFromSolAmount,
  hasCoinCreatorMigratedToSharingConfig,
  isSharingConfigEditable,
  newBondingCurve,
  OnlinePumpSdk,
  PUMP_SDK,
  type BondingCurve,
  type SharingConfig,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { AGENT_SHARE_BPS, CREATOR_SHARE_BPS } from "@/lib/fireagent";
import type { CurveState } from "@/lib/curve";

/**
 * Everything FIREAGENT does on pump.fun goes through pump.fun's own programs:
 *
 *  - launch: create_v2 (optionally with the creator's first buy), then pump-fees
 *    create_fee_sharing_config + update_fee_shares, which set the coin's creator fee
 *    to split 50/50 between the creator and the FIREAGENT wallet. pump.fun locks a
 *    split once it is set, so nobody (us included) can change it afterwards.
 *  - connect: the same two pump-fees instructions for a coin that already exists,
 *    signed by its creator.
 *
 * We never hold the creator's fees: pump.fun pays each side directly when anyone
 * cranks distribute_creator_fees.
 */

const TX_LIMIT = 1232;
const DECIMALS = 6;

export const pumpSdk = (connection: Connection) => new OnlinePumpSdk(connection);

export interface LaunchParams {
  mint: PublicKey;
  creator: PublicKey;
  agent: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  /** Creator's first buy, in lamports (0 = none). */
  buyLamports: bigint;
}

function splitShares(creator: PublicKey, agent: PublicKey) {
  return [
    { address: creator, shareBps: CREATOR_SHARE_BPS },
    { address: agent, shareBps: AGENT_SHARE_BPS },
  ];
}

/** The two pump-fees instructions that lock the split; `currentCreator` must sign. */
export async function splitInstructions(opts: {
  mint: PublicKey;
  creator: PublicKey;
  agent: PublicKey;
  /** false when a sharing config already exists (unset) — then only update it. */
  createConfig: boolean;
  /** Graduated coins pass their pool to both instructions. */
  graduated: boolean;
  /** Who the config pays today: [creator] for a freshly created config. */
  currentShareholders?: PublicKey[];
}): Promise<TransactionInstruction[]> {
  const out: TransactionInstruction[] = [];
  if (opts.createConfig) {
    out.push(
      await PUMP_SDK.createFeeSharingConfig({
        creator: opts.creator,
        mint: opts.mint,
        pool: opts.graduated ? canonicalPumpPoolPda(opts.mint) : null,
      })
    );
  }
  out.push(
    await PUMP_SDK.updateFeeShares({
      authority: opts.creator,
      mint: opts.mint,
      currentShareholders: opts.currentShareholders ?? [opts.creator],
      newShareholders: splitShares(opts.creator, opts.agent),
      bondingCurveComplete: opts.graduated,
    })
  );
  return out;
}

/**
 * Instruction groups for a launch, in the order they must land:
 * [create], [create the sharing config], [lock the split], [first buy (optional)].
 * The split is locked before anyone (the creator included) can buy.
 */
export async function buildLaunchInstructions(connection: Connection, p: LaunchParams): Promise<TransactionInstruction[][]> {
  const common = {
    mint: p.mint,
    name: p.name,
    symbol: p.symbol,
    uri: p.uri,
    creator: p.creator,
    user: p.creator,
    mayhemMode: false,
  };
  const create = await PUMP_SDK.createV2Instruction(common);
  const [config, update] = await splitInstructions({ mint: p.mint, creator: p.creator, agent: p.agent, createConfig: true, graduated: false });
  if (p.buyLamports <= 0n) return [[create], [config], [update]];

  const sdk = pumpSdk(connection);
  const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
  const quoteAmount = new BN(p.buyLamports.toString());
  // By the time the buy runs the split is locked, so the curve's creator is the
  // sharing config: the buy's creator-vault account has to match that.
  const curve = { ...newBondingCurve(global), creator: feeSharingConfigPda(p.mint), isMayhemMode: false };
  // (newBondingCurve copies Global.mayhemModeEnabled; launches here are never mayhem coins.)
  const buy = await PUMP_SDK.buyV2Instructions({
    global,
    bondingCurveAccountInfo: null as never, // unused by the builder
    bondingCurve: curve,
    associatedUserAccountInfo: null,
    mint: p.mint,
    user: p.creator,
    quoteAmount,
    amount: getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: null,
      bondingCurve: curve,
      amount: quoteAmount,
      quoteMint: NATIVE_MINT,
    }),
    slippage: 1,
  });
  return [[create], [config], [update], buy];
}

const budget = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });

/**
 * Turn instruction groups into transactions, in order. With the FIREAGENT lookup
 * table everything usually fits one atomic v0 transaction; without it, groups are
 * packed greedily into as few legacy transactions as fit (sent one after another).
 */
export function packTransactions(
  groups: TransactionInstruction[][],
  feePayer: PublicKey,
  blockhash: string,
  lookupTable: AddressLookupTableAccount | null = null,
  units = 600_000
): VersionedTransaction[] {
  const compile = (ixs: TransactionInstruction[], v0: boolean, withBudget = true) => {
    const instructions = withBudget ? [budget(units), ...ixs] : ixs;
    const msg = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions });
    return new VersionedTransaction(v0 && lookupTable ? msg.compileToV0Message([lookupTable]) : msg.compileToLegacyMessage());
  };
  const fits = (tx: VersionedTransaction) => {
    try {
      return tx.serialize().length <= TX_LIMIT;
    } catch {
      return false;
    }
  };

  if (lookupTable) {
    const one = compile(groups.flat(), true);
    if (fits(one)) return [one];
    // The default budget (200k CU per instruction, pooled) covers a launch, and
    // dropping the budget instruction saves the bytes that are often missing.
    const lean = compile(groups.flat(), true, false);
    if (fits(lean)) return [lean];
  }
  const out: VersionedTransaction[] = [];
  let current: TransactionInstruction[] = [];
  for (const g of groups) {
    if (current.length && fits(compile([...current, ...g], false))) {
      current = [...current, ...g];
      continue;
    }
    if (current.length) out.push(compile(current, false));
    current = g;
  }
  if (current.length) out.push(compile(current, false));
  for (const tx of out) if (!fits(tx)) throw new Error("Transaction too large");
  return out;
}

/** The lookup table named by FIREAGENT_LOOKUP_TABLE, if set and live. */
export async function fetchLookupTable(connection: Connection): Promise<AddressLookupTableAccount | null> {
  const key = process.env.FIREAGENT_LOOKUP_TABLE;
  if (!key) return null;
  try {
    return (await connection.getAddressLookupTable(new PublicKey(key))).value;
  } catch (e) {
    console.error("[pump] lookup table", e);
    return null;
  }
}

// ---------- reading a coin ----------

export type SplitStatus =
  /** No pump.fun bonding curve for this mint. */
  | { status: "not-pump" }
  /** Fees go straight to the creator wallet: connectable by that wallet. */
  | { status: "none"; creator: string; graduated: boolean }
  /** A sharing config exists but its split was never set: connectable by its admin. */
  | { status: "unset"; creator: string; graduated: boolean; shareholders: string[] }
  /** Split 50/50 with this agent. */
  | { status: "active"; creator: string; locked: boolean; graduated: boolean }
  /** Fees are shared some other way, permanently. */
  | { status: "other"; graduated: boolean };

function isAgentSplit(cfg: SharingConfig, agent: PublicKey) {
  const a = cfg.shareholders.find((s) => s.address.equals(agent));
  return cfg.shareholders.length === 2 && a?.shareBps === AGENT_SHARE_BPS;
}

export async function readSplit(connection: Connection, mint: PublicKey, agent: PublicKey): Promise<SplitStatus> {
  const cfgKey = feeSharingConfigPda(mint);
  const [curveInfo, cfgInfo] = await connection.getMultipleAccountsInfo([bondingCurvePda(mint), cfgKey]);
  if (!curveInfo) return { status: "not-pump" };
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  const graduated = curve.complete;

  if (!cfgInfo || !hasCoinCreatorMigratedToSharingConfig({ mint, creator: curve.creator })) {
    if (cfgInfo) {
      // A config exists but the curve still pays a wallet: treat it as unset by that config's admin.
      const cfg = PUMP_SDK.decodeSharingConfig(cfgInfo);
      if (isSharingConfigEditable({ sharingConfig: cfg })) {
        return { status: "unset", creator: cfg.admin.toBase58(), graduated, shareholders: cfg.shareholders.map((s) => s.address.toBase58()) };
      }
    }
    return { status: "none", creator: curve.creator.toBase58(), graduated };
  }

  const cfg = PUMP_SDK.decodeSharingConfig(cfgInfo);
  if (isAgentSplit(cfg, agent)) {
    const creator = cfg.shareholders.find((s) => !s.address.equals(agent))!.address.toBase58();
    return { status: "active", creator, locked: !isSharingConfigEditable({ sharingConfig: cfg }), graduated };
  }
  if (isSharingConfigEditable({ sharingConfig: cfg })) {
    return { status: "unset", creator: cfg.admin.toBase58(), graduated, shareholders: cfg.shareholders.map((s) => s.address.toBase58()) };
  }
  return { status: "other", graduated };
}

/** Instructions for an existing coin's creator to hand half its fees to the agent. */
export async function buildConnectInstructions(
  connection: Connection,
  mint: PublicKey,
  wallet: PublicKey,
  agent: PublicKey
): Promise<{ instructions: TransactionInstruction[] } | { error: string }> {
  const s = await readSplit(connection, mint, agent);
  switch (s.status) {
    case "not-pump":
      return { error: "That address isn't a pump.fun coin" };
    case "active":
      return { error: "This coin is already connected to FIREAGENT" };
    case "other":
      return { error: "This coin's creator fees are already shared another way, and pump.fun doesn't allow changing that" };
  }
  if (s.creator !== wallet.toBase58()) {
    return { error: `Only the coin's creator can connect it. Connect the wallet ${short(s.creator)}.` };
  }

  const pre: TransactionInstruction[] = [];
  const curve = await fetchCurve(connection, mint);
  // Fees that v3 trades left on the curve must be swept before the config can change.
  if (curve && !curve.creatorFee.isZero()) {
    pre.push(
      await PUMP_SDK.sweepCreatorFeeInstruction({ payer: wallet, mint, creator: curve.creator, quoteMint: NATIVE_MINT })
    );
  }
  const split = await splitInstructions({
    mint,
    creator: wallet,
    agent,
    createConfig: s.status === "none",
    graduated: s.graduated,
    currentShareholders: s.status === "unset" ? s.shareholders.map((a) => new PublicKey(a)) : [wallet],
  });
  return { instructions: [...pre, ...split] };
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export async function fetchCurve(connection: Connection, mint: PublicKey): Promise<BondingCurve | null> {
  const info = await connection.getAccountInfo(bondingCurvePda(mint));
  return info ? PUMP_SDK.decodeBondingCurve(info) : null;
}

export async function fetchCurves(connection: Connection, mints: PublicKey[]): Promise<Map<string, BondingCurve>> {
  const out = new Map<string, BondingCurve>();
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk.map(bondingCurvePda));
    infos.forEach((info, j) => {
      if (info) out.set(chunk[j].toBase58(), PUMP_SDK.decodeBondingCurve(info));
    });
  }
  return out;
}

/** pump.fun curve → the whole-unit reserves lib/curve.ts prices from. */
export function toCurveState(c: BondingCurve): CurveState {
  return {
    virtualSol: Number(c.virtualQuoteReserves.toString()) / 1e9,
    virtualTokens: Number(c.virtualTokenReserves.toString()) / 10 ** DECIMALS,
    realTokens: Number(c.realTokenReserves.toString()) / 10 ** DECIMALS,
  };
}

export const pumpUrl = (mint: string) => `https://pump.fun/coin/${mint}`;
