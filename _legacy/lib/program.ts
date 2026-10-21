/**
 * Hand-rolled client for the firepad Anchor program (no IDL needed yet).
 * Keep in sync with anchor/programs/firepad/src — instruction discriminators are
 * sha256("global:<ix_name>")[0..8], account discriminators sha256("account:<Name>")[0..8],
 * and every `keys` array follows the field order of the matching #[derive(Accounts)].
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { CURVE } from "./curve";
import { CLUSTER } from "./rpc";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_FIREPAD_PROGRAM_ID || "2itmJRT2GFcfAP7uWJky1LQGwACqLJgU8jZ1pWirAbho"
);
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const IX = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  updateConfig: [29, 158, 252, 191, 10, 83, 219, 99],
  migrate: [155, 234, 231, 146, 236, 158, 162, 30],
  createToken: [84, 52, 204, 228, 24, 140, 234, 75],
  buy: [102, 6, 61, 18, 1, 218, 235, 234],
  sell: [51, 230, 133, 164, 1, 127, 131, 173],
  collectFees: [164, 152, 207, 99, 30, 186, 19, 182],
  takeFeeTokens: [206, 40, 7, 156, 249, 41, 20, 60],
  depositSwappedFees: [182, 63, 224, 0, 193, 83, 210, 211],
  setRewardsRoot: [126, 220, 20, 69, 189, 48, 98, 60],
  claimRewards: [4, 144, 132, 71, 116, 23, 151, 80],
  claimCreatorFees: [0, 23, 125, 234, 156, 118, 134, 89],
};
const ACCOUNT = {
  config: [155, 12, 170, 224, 30, 250, 204, 130],
  tokenState: [218, 112, 6, 149, 55, 186, 168, 163],
  claimStatus: [22, 183, 249, 157, 247, 95, 150, 96],
};

/** Mirrors on-chain limits in create_token.rs. */
export const MAX_NAME_LEN = 32;
export const MAX_SYMBOL_LEN = 10;
export const MAX_URI_LEN = 200;

// ---------- PDAs ----------

const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export const configPda = () => pda(Buffer.from("config"));
export const tokenStatePda = (mint: PublicKey) => pda(Buffer.from("token"), mint.toBuffer());
export const solVaultPda = (mint: PublicKey) => pda(Buffer.from("sol_vault"), mint.toBuffer());
export const creatorVaultPda = (mint: PublicKey) => pda(Buffer.from("creator_vault"), mint.toBuffer());
export const rewardVaultPda = (mint: PublicKey) => pda(Buffer.from("reward_vault"), mint.toBuffer());
export const claimStatusPda = (mint: PublicKey, owner: PublicKey) =>
  pda(Buffer.from("claim"), mint.toBuffer(), owner.toBuffer());

export function ata2022(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

// ---------- borsh helpers ----------

class Writer {
  private parts: Buffer[] = [];
  bytes(b: number[] | Uint8Array) {
    this.parts.push(Buffer.from(b));
    return this;
  }
  u8(n: number) {
    return this.bytes([n]);
  }
  u16(n: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    return this.bytes(b);
  }
  u32(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return this.bytes(b);
  }
  u64(n: bigint) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return this.bytes(b);
  }
  str(s: string) {
    const b = Buffer.from(s, "utf8");
    return this.u32(b.length).bytes(b);
  }
  option<T>(v: T | undefined | null, write: (v: T) => void) {
    if (v === undefined || v === null) return this.u8(0);
    this.u8(1);
    write(v);
    return this;
  }
  done() {
    return Buffer.concat(this.parts);
  }
}

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });
const ix = (keys: AccountMeta[], data: Buffer) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

// ---------- curve params ----------

export interface CurveParams {
  initialVirtualSolReserves: bigint;
  initialVirtualTokenReserves: bigint;
  initialRealTokenReserves: bigint;
  tokenTotalSupply: bigint;
  decimals: number;
}

const unit = (n: number, decimals: number) => BigInt(n) * 10n ** BigInt(decimals);

/** Same values as CurveParams::PUMP_FUN on-chain. */
export const PUMP_FUN_CURVE: CurveParams = {
  initialVirtualSolReserves: unit(CURVE.initialVirtualSol, 9),
  initialVirtualTokenReserves: unit(CURVE.initialVirtualTokens, CURVE.decimals),
  initialRealTokenReserves: unit(CURVE.initialRealTokens, CURVE.decimals),
  tokenTotalSupply: unit(CURVE.totalSupply, CURVE.decimals),
  decimals: CURVE.decimals,
};

function writeCurve(wr: Writer, c: CurveParams) {
  wr.u64(c.initialVirtualSolReserves)
    .u64(c.initialVirtualTokenReserves)
    .u64(c.initialRealTokenReserves)
    .u64(c.tokenTotalSupply)
    .u8(c.decimals);
}

// ---------- decoding ----------

class Reader {
  o = 8; // skip discriminator
  constructor(private d: Buffer) {}
  key() {
    this.o += 32;
    return new PublicKey(this.d.subarray(this.o - 32, this.o));
  }
  bytes(n: number) {
    this.o += n;
    return Uint8Array.from(this.d.subarray(this.o - n, this.o));
  }
  u8() {
    return this.d[this.o++];
  }
  bool() {
    return this.u8() === 1;
  }
  u16() {
    this.o += 2;
    return this.d.readUInt16LE(this.o - 2);
  }
  u32() {
    this.o += 4;
    return this.d.readUInt32LE(this.o - 4);
  }
  u64() {
    this.o += 8;
    return this.d.readBigUInt64LE(this.o - 8);
  }
}

const hasDisc = (d: Buffer, disc: number[]) => d.length >= 8 && disc.every((b, i) => d[i] === b);

export interface ProtocolConfig {
  authority: PublicKey;
  keeper: PublicKey;
  /** Transfer fee for NEW launches (each mint's fee is fixed at launch). */
  feeBps: number;
  curve: CurveParams;
}

export function decodeConfig(d: Buffer): ProtocolConfig | null {
  if (!hasDisc(d, ACCOUNT.config) || d.length < 8 + 64 + 2 + 33) return null;
  const rd = new Reader(d);
  return {
    authority: rd.key(),
    keeper: rd.key(),
    feeBps: rd.u16(),
    curve: {
      initialVirtualSolReserves: rd.u64(),
      initialVirtualTokenReserves: rd.u64(),
      initialRealTokenReserves: rd.u64(),
      tokenTotalSupply: rd.u64(),
      decimals: rd.u8(),
    },
  };
}

export async function fetchConfig(connection: Connection): Promise<ProtocolConfig | null> {
  const info = await connection.getAccountInfo(configPda());
  return info && info.owner.equals(PROGRAM_ID) ? decodeConfig(info.data) : null;
}

export interface OnchainTokenState {
  mint: PublicKey;
  creator: PublicKey;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  initialRealTokenReserves: bigint;
  creatorFeesOwed: bigint;
  holderFeesTotal: bigint;
  rewardsRoot: Uint8Array;
  rewardsRootTotal: bigint;
  rewardsEpoch: number;
  holderClaimedTotal: bigint;
  pendingFeeTokens: bigint;
  feeTokensToKeeperTotal: bigint;
  keeperSolDepositedTotal: bigint;
  complete: boolean;
  migrated: boolean;
}

/** Field order = `TokenState` in state.rs. */
export function decodeTokenState(d: Buffer): OnchainTokenState | null {
  if (!hasDisc(d, ACCOUNT.tokenState) || d.length < 8 + 64 + 8 * 8 + 32 + 8 + 4 + 8 * 4 + 2) return null;
  const rd = new Reader(d);
  return {
    mint: rd.key(),
    creator: rd.key(),
    virtualSolReserves: rd.u64(),
    virtualTokenReserves: rd.u64(),
    realSolReserves: rd.u64(),
    realTokenReserves: rd.u64(),
    tokenTotalSupply: rd.u64(),
    initialRealTokenReserves: rd.u64(),
    creatorFeesOwed: rd.u64(),
    holderFeesTotal: rd.u64(),
    rewardsRoot: rd.bytes(32),
    rewardsRootTotal: rd.u64(),
    rewardsEpoch: rd.u32(),
    holderClaimedTotal: rd.u64(),
    pendingFeeTokens: rd.u64(),
    feeTokensToKeeperTotal: rd.u64(),
    keeperSolDepositedTotal: rd.u64(),
    complete: rd.bool(),
    migrated: rd.bool(),
  };
}

export async function fetchTokenStates(connection: Connection, mints: PublicKey[]) {
  const out = new Map<string, OnchainTokenState>();
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk.map(tokenStatePda));
    infos.forEach((info, j) => {
      if (!info || !info.owner.equals(PROGRAM_ID)) return;
      const s = decodeTokenState(info.data);
      if (s) out.set(chunk[j].toBase58(), s);
    });
  }
  return out;
}

/** Lamports a wallet has already claimed from holder rewards (0 if never). */
export function decodeClaimed(d: Buffer | null | undefined): bigint {
  return d && hasDisc(d, ACCOUNT.claimStatus) ? d.readBigUInt64LE(8) : 0n;
}

// ---------- Token-2022 account parsing ----------

/** Token-2022 extension type ids we read. */
const EXT_TRANSFER_FEE_CONFIG = 1;
const EXT_TRANSFER_FEE_AMOUNT = 2;
const BASE_ACCOUNT_LEN = 165; // extensions start after the account-type byte at 165

function findExtension(d: Buffer, type: number): Buffer | null {
  let o = BASE_ACCOUNT_LEN + 1;
  while (o + 4 <= d.length) {
    const t = d.readUInt16LE(o);
    const len = d.readUInt16LE(o + 2);
    if (t === type) return d.subarray(o + 4, o + 4 + len);
    if (t === 0) return null;
    o += 4 + len;
  }
  return null;
}

/** Token account: owner, amount, and fees withheld in it (awaiting harvest). */
export function decodeTokenAccount(d: Buffer) {
  const ext = d.length > BASE_ACCOUNT_LEN ? findExtension(d, EXT_TRANSFER_FEE_AMOUNT) : null;
  return {
    mint: new PublicKey(d.subarray(0, 32)),
    owner: new PublicKey(d.subarray(32, 64)),
    amount: d.readBigUInt64LE(64),
    withheld: ext && ext.length >= 8 ? ext.readBigUInt64LE(0) : 0n,
  };
}

/** Token amount at bytes 64..72 (same as classic SPL accounts). */
export function decodeTokenAmount(d: Buffer | undefined | null): bigint {
  return d && d.length >= 72 ? d.readBigUInt64LE(64) : 0n;
}

/** Mint: transfer fee (bps) currently in force and fees withheld in the mint itself. */
export function decodeMintFee(d: Buffer): { feeBps: number; withheldInMint: bigint } | null {
  const ext = d.length > BASE_ACCOUNT_LEN ? findExtension(d, EXT_TRANSFER_FEE_CONFIG) : null;
  if (!ext || ext.length < 108) return null;
  // config authority(32) withdraw authority(32) withheld(8) older{epoch,max,bps}(18) newer{epoch,max,bps}(18)
  return { feeBps: ext.readUInt16LE(106), withheldInMint: ext.readBigUInt64LE(64) };
}

const EXT_TOKEN_METADATA = 19;

/** Mint: name / symbol / uri from the TokenMetadata extension (what wallets and explorers show). */
export function decodeMintMetadata(d: Buffer): { name: string; symbol: string; uri: string } | null {
  const ext = d.length > BASE_ACCOUNT_LEN ? findExtension(d, EXT_TOKEN_METADATA) : null;
  if (!ext) return null;
  let o = 64; // update authority(32) + mint(32)
  const str = () => {
    if (o + 4 > ext.length) throw new Error("short metadata");
    const len = ext.readUInt32LE(o);
    if (o + 4 + len > ext.length) throw new Error("short metadata");
    const v = ext.subarray(o + 4, o + 4 + len).toString("utf8");
    o += 4 + len;
    return v;
  };
  try {
    return { name: str(), symbol: str(), uri: str() };
  } catch {
    return null;
  }
}

// ---------- admin ----------

export function initializeIx(
  authority: PublicKey,
  feeBps: number,
  keeper: PublicKey,
  curve: CurveParams = PUMP_FUN_CURVE
): TransactionInstruction {
  const wr = new Writer().bytes(IX.initialize).u16(feeBps).bytes(keeper.toBuffer());
  writeCurve(wr, curve);
  return ix([w(authority, true), w(configPda()), r(SystemProgram.programId)], wr.done());
}

export interface UpdateConfigParams {
  feeBps?: number;
  curve?: CurveParams;
  newAuthority?: PublicKey;
  newKeeper?: PublicKey;
}

export function updateConfigIx(authority: PublicKey, p: UpdateConfigParams): TransactionInstruction {
  const wr = new Writer().bytes(IX.updateConfig);
  wr.option(p.feeBps, (v) => wr.u16(v));
  wr.option(p.curve, (v) => writeCurve(wr, v));
  wr.option(p.newAuthority, (v) => wr.bytes(v.toBuffer()));
  wr.option(p.newKeeper, (v) => wr.bytes(v.toBuffer()));
  return ix([r(authority, true), w(configPda())], wr.done());
}

// ---------- graduation: Raydium CPMM ----------

/** Must match `raydium` in anchor/programs/firepad/src/instructions/migrate.rs for the cluster the program was built for. */
export const RAYDIUM =
  CLUSTER === "mainnet-beta"
    ? {
        cpmm: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
        ammConfig: new PublicKey("D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2"),
        createPoolFee: new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"),
      }
    : {
        cpmm: new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"),
        ammConfig: new PublicKey("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy"),
        createPoolFee: new PublicKey("3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy"),
      };
export const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const rayPda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, RAYDIUM.cpmm)[0];
const splAta = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

/** The Raydium CPMM pool a coin migrates into (canonical PDA for config 0 + WSOL/mint). */
export function raydiumPool(mint: PublicKey) {
  const wsolFirst = Buffer.compare(WSOL_MINT.toBuffer(), mint.toBuffer()) < 0;
  const [m0, m1] = wsolFirst ? [WSOL_MINT, mint] : [mint, WSOL_MINT];
  const pool = rayPda(Buffer.from("pool"), RAYDIUM.ammConfig.toBuffer(), m0.toBuffer(), m1.toBuffer());
  return {
    pool,
    wsolFirst,
    authority: rayPda(Buffer.from("vault_and_lp_mint_auth_seed")),
    lpMint: rayPda(Buffer.from("pool_lp_mint"), pool.toBuffer()),
    vault0: rayPda(Buffer.from("pool_vault"), pool.toBuffer(), m0.toBuffer()),
    vault1: rayPda(Buffer.from("pool_vault"), pool.toBuffer(), m1.toBuffer()),
    observation: rayPda(Buffer.from("observation"), pool.toBuffer()),
  };
}

/**
 * Permissionless, after graduation: create the coin's Raydium CPMM pool from the curve's
 * SOL + reserved tokens and burn the LP. Needs a high compute limit (see migrateTx).
 */
export function migrateIx(caller: PublicKey, mint: PublicKey) {
  const ts = tokenStatePda(mint);
  const solVault = solVaultPda(mint);
  const p = raydiumPool(mint);
  return ix(
    [
      r(caller, true),
      w(ts),
      r(mint),
      w(ata2022(ts, mint)),
      w(solVault),
      w(creatorVaultPda(mint)),
      w(rewardVaultPda(mint)),
      w(splAta(solVault, WSOL_MINT)),
      w(ata2022(solVault, mint)),
      r(WSOL_MINT),
      r(RAYDIUM.cpmm),
      r(RAYDIUM.ammConfig),
      r(p.authority),
      w(p.pool),
      w(p.lpMint),
      w(splAta(solVault, p.lpMint)),
      w(p.vault0),
      w(p.vault1),
      w(RAYDIUM.createPoolFee),
      w(p.observation),
      r(SPL_TOKEN_PROGRAM_ID),
      r(TOKEN_2022_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
      r(SYSVAR_RENT_PUBKEY),
    ],
    Buffer.from(IX.migrate)
  );
}

export function migrateTx(caller: PublicKey, mint: PublicKey) {
  return new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }))
    .add(migrateIx(caller, mint));
}

// ---------- launch & trade ----------

export function createTokenIx(creator: PublicKey, mint: PublicKey, meta: { name: string; symbol: string; uri: string }) {
  const ts = tokenStatePda(mint);
  return ix(
    [
      w(creator, true),
      r(configPda()),
      w(mint, true),
      w(ts),
      w(ata2022(ts, mint)),
      w(solVaultPda(mint)),
      w(creatorVaultPda(mint)),
      w(rewardVaultPda(mint)),
      r(TOKEN_2022_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
      r(SYSVAR_RENT_PUBKEY),
    ],
    new Writer().bytes(IX.createToken).str(meta.name).str(meta.symbol).str(meta.uri).done()
  );
}

/** create_token does several CPIs (mint + 2 extensions + metadata + ATA). */
export function createTokenTx(creator: PublicKey, mint: PublicKey, meta: { name: string; symbol: string; uri: string }) {
  return new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }))
    .add(createTokenIx(creator, mint, meta));
}

/** Amounts in base units. `minTokensOut` = tokens that land in the wallet (after the fee). */
export function buyIx(buyer: PublicKey, mint: PublicKey, solIn: bigint, minTokensOut: bigint) {
  const ts = tokenStatePda(mint);
  return ix(
    [
      w(buyer, true),
      w(ts),
      r(mint),
      w(ata2022(ts, mint)),
      w(ata2022(buyer, mint)),
      w(solVaultPda(mint)),
      r(TOKEN_2022_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    new Writer().bytes(IX.buy).u64(solIn).u64(minTokensOut).done()
  );
}

export function sellIx(seller: PublicKey, mint: PublicKey, tokensIn: bigint, minSolOut: bigint) {
  const ts = tokenStatePda(mint);
  return ix(
    [
      w(seller, true),
      w(ts),
      r(mint),
      w(ata2022(ts, mint)),
      w(ata2022(seller, mint)),
      w(solVaultPda(mint)),
      r(TOKEN_2022_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    new Writer().bytes(IX.sell).u64(tokensIn).u64(minSolOut).done()
  );
}

// ---------- fees ----------

/**
 * Token-2022 HarvestWithheldTokensToMint (TransferFeeExtension=26, sub-ix 4).
 * Permissionless: sweeps fees withheld in token accounts into the mint.
 */
export function harvestToMintIx(mint: PublicKey, sources: PublicKey[]) {
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [w(mint), ...sources.map((s) => w(s))],
    data: Buffer.from([26, 4]),
  });
}

/** Permissionless: withdraw harvested fees and (pre-graduation) swap them to SOL in the curve. */
export function collectFeesIx(caller: PublicKey, mint: PublicKey) {
  const ts = tokenStatePda(mint);
  return ix(
    [
      r(caller, true),
      w(ts),
      w(mint),
      w(ata2022(ts, mint)),
      w(solVaultPda(mint)),
      w(creatorVaultPda(mint)),
      w(rewardVaultPda(mint)),
      r(TOKEN_2022_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    Buffer.from(IX.collectFees)
  );
}

export function takeFeeTokensIx(keeper: PublicKey, mint: PublicKey, amount: bigint) {
  const ts = tokenStatePda(mint);
  return ix(
    [
      w(keeper, true),
      r(configPda()),
      w(ts),
      r(mint),
      w(ata2022(ts, mint)),
      w(ata2022(keeper, mint)),
      r(TOKEN_2022_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    new Writer().bytes(IX.takeFeeTokens).u64(amount).done()
  );
}

export function depositSwappedFeesIx(keeper: PublicKey, mint: PublicKey, lamports: bigint) {
  return ix(
    [
      w(keeper, true),
      r(configPda()),
      w(tokenStatePda(mint)),
      w(creatorVaultPda(mint)),
      w(rewardVaultPda(mint)),
      r(SystemProgram.programId),
    ],
    new Writer().bytes(IX.depositSwappedFees).u64(lamports).done()
  );
}

// ---------- claims ----------

export function setRewardsRootIx(keeper: PublicKey, mint: PublicKey, root: Uint8Array, total: bigint, epoch: number) {
  return ix(
    [r(keeper, true), r(configPda()), w(tokenStatePda(mint))],
    new Writer().bytes(IX.setRewardsRoot).bytes(root).u64(total).u32(epoch).done()
  );
}

export function claimRewardsIx(owner: PublicKey, mint: PublicKey, cumulative: bigint, proof: Uint8Array[]) {
  const wr = new Writer().bytes(IX.claimRewards).u64(cumulative).u32(proof.length);
  proof.forEach((p) => wr.bytes(p));
  return ix(
    [
      w(owner, true),
      w(tokenStatePda(mint)),
      w(claimStatusPda(mint, owner)),
      w(rewardVaultPda(mint)),
      r(SystemProgram.programId),
    ],
    wr.done()
  );
}

export function claimCreatorFeesIx(creator: PublicKey, mint: PublicKey) {
  return ix(
    [w(creator, true), w(tokenStatePda(mint)), w(creatorVaultPda(mint)), r(SystemProgram.programId)],
    Buffer.from(IX.claimCreatorFees)
  );
}
