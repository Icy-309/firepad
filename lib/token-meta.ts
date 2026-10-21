import { PublicKey } from "@solana/web3.js";

/**
 * Reading coin names off-chain-free: pump.fun's create_v2 coins keep name/symbol/uri
 * in the mint's own metadata extension; older create (v1) coins use a Metaplex
 * metadata account. Both decoders return null on anything they don't recognise.
 */

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export const MAX_NAME_LEN = 32;
export const MAX_SYMBOL_LEN = 10;
export const MAX_URI_LEN = 200;

export interface CoinMeta {
  name: string;
  symbol: string;
  uri: string;
}

const BASE_ACCOUNT_LEN = 165; // extensions start after the account-type byte at 165
const EXT_TOKEN_METADATA = 19;

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

function reader(buf: Buffer, start: number) {
  let o = start;
  return () => {
    if (o + 4 > buf.length) throw new Error("short metadata");
    const len = buf.readUInt32LE(o);
    if (o + 4 + len > buf.length) throw new Error("short metadata");
    const v = buf.subarray(o + 4, o + 4 + len).toString("utf8").replace(/\0+$/, "");
    o += 4 + len;
    return v;
  };
}

/** Mint account → the TokenMetadata extension (create_v2 coins). */
export function decodeMintMetadata(d: Buffer): CoinMeta | null {
  const ext = d.length > BASE_ACCOUNT_LEN ? findExtension(d, EXT_TOKEN_METADATA) : null;
  if (!ext) return null;
  try {
    const str = reader(ext, 64); // update authority(32) + mint(32)
    return { name: str(), symbol: str(), uri: str() };
  } catch {
    return null;
  }
}

export const metaplexPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()], METAPLEX_PROGRAM_ID)[0];

/** Metaplex metadata account → name/symbol/uri (create v1 coins). */
export function decodeMetaplexMetadata(d: Buffer): CoinMeta | null {
  try {
    const str = reader(d, 1 + 32 + 32); // key + update authority + mint
    return { name: str().trim(), symbol: str().trim(), uri: str().trim() };
  } catch {
    return null;
  }
}

/** Token account (SPL or Token-2022): owner and amount sit at the same offsets. */
export function decodeTokenAccount(d: Buffer) {
  return { mint: new PublicKey(d.subarray(0, 32)), owner: new PublicKey(d.subarray(32, 64)), amount: d.readBigUInt64LE(64) };
}
