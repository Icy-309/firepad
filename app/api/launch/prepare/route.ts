import { NextResponse } from "next/server";
import bs58 from "bs58";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { AuthError, verifySignedMessage } from "@/lib/server/auth";
import { issueVanityKey, PoolEmptyError, RateLimitError, reclaimStaleKeys, releaseVanityKey } from "@/lib/server/store";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { ImageError, MAX_IMAGE_BYTES, saveImage, sniffImage } from "@/lib/server/images";
import { assertMainnetConnection, connection, MainnetRpcError } from "@/lib/server/connection";
import { MAX_NAME_LEN, MAX_SYMBOL_LEN, MAX_URI_LEN } from "@/lib/token-meta";
import { buildLaunchInstructions, fetchLookupTable, packTransactions } from "@/lib/server/pump";
import { agentKey } from "@/lib/server/agent-key";
import { normalizeSocials } from "@/lib/socials";
import { metadataJson } from "@/lib/server/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

/** Launching costs rent for the mint, curve and sharing config; a wallet without it can't launch anyway. */
const MIN_BALANCE_LAMPORTS = Math.round(Number(process.env.VANITY_MIN_BALANCE_SOL || 0.02) * LAMPORTS_PER_SOL);
const MAX_PER_IP_PER_HOUR = Number(process.env.VANITY_MAX_PER_IP_HOUR || 10);

/**
 * POST multipart/form-data { wallet, message, signature, name, symbol, description, image (file),
 *   website?, twitter?, telegram?, buySol? }
 * → { mint, transactions: base64[], lastValidBlockHeight }
 *
 * Reserves a pre-ground "...fire" mint keypair for the signing wallet, stores the
 * coin image and off-chain metadata, and builds the pump.fun launch: create_v2,
 * the fee-sharing config locked 50/50 between the creator and FIREPAD payout wallet, then the
 * optional first buy. The transactions come back already signed by the mint key
 * (which never leaves the server); the wallet signs them all in one approval and
 * sends them in order. Images only arrive with a signed launch, so there's no
 * anonymous upload endpoint.
 */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > MAX_IMAGE_BYTES + 64_000) return bad("Image is larger than 4 MB");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Expected a form upload");
  }
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const name = field("name").trim();
  const symbol = field("symbol").trim().toUpperCase();
  const description = field("description").trim();
  const file = form.get("image");
  const imageFile = file && typeof file !== "string" && file.size > 0 ? file : null;

  // Validate before consuming a keypair.
  if (!name || byteLen(name) > MAX_NAME_LEN) return bad(`Name must be 1–${MAX_NAME_LEN} bytes`);
  if (!symbol || byteLen(symbol) > MAX_SYMBOL_LEN) return bad(`Symbol must be 1–${MAX_SYMBOL_LEN} bytes`);
  if (description.length > 1000) return bad("Description is too long (max 1000 chars)");
  if (!imageFile) return bad("Add an image for your coin");
  if (imageFile.size > MAX_IMAGE_BYTES) return bad("Image is larger than 4 MB");
  const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
  if (!sniffImage(imageBytes)) return bad("Image must be a PNG, JPG, GIF or WEBP");
  const { socials, errors } = normalizeSocials({
    website: field("website"),
    twitter: field("twitter"),
    telegram: field("telegram"),
  });
  if (errors.length) return bad(`Check the ${errors.join(", ")} link`);
  const buySol = field("buySol").trim() ? Number(field("buySol")) : 0;
  if (!Number.isFinite(buySol) || buySol < 0 || buySol > 100) return bad("Enter a first buy between 0 and 100 SOL");
  const buyLamports = BigInt(Math.round(buySol * LAMPORTS_PER_SOL));
  const agent = agentKey();
  if (!agent) {
    console.error("[launch/prepare] NEXT_PUBLIC_FIREAGENT_WALLET is not set");
    return NextResponse.json({ error: "Launches aren't configured on this server" }, { status: 500 });
  }

  let wallet: string;
  try {
    wallet = verifySignedMessage(
      "launch",
      { wallet: field("wallet"), message: field("message"), signature: field("signature") },
      req
    );
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }

  // Wallets are free to create, so also limit per IP…
  if (!rateLimit(`launch:${clientIp(req)}`, MAX_PER_IP_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many launches from this network — try again later" }, { status: 429 });
  }
  // …and require the SOL a launch actually needs, which an address-hoarding script would have to lock up.
  try {
    await assertMainnetConnection();
    const lamports = await connection.getBalance(new PublicKey(wallet));
    const needed = MIN_BALANCE_LAMPORTS + Number(buyLamports);
    if (lamports < needed) {
      return bad(`You need at least ${(needed / LAMPORTS_PER_SOL).toFixed(3)} SOL in this wallet for this launch`);
    }
  } catch (e) {
    if (e instanceof MainnetRpcError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[launch/prepare] balance check", e);
    return NextResponse.json({ error: "Couldn't reach Solana — try again shortly" }, { status: 503 });
  }

  let origin: string;
  try {
    origin = siteOrigin(req);
  } catch (e) {
    console.error("[launch/prepare]", e);
    return NextResponse.json({ error: "Launches aren't configured on this server" }, { status: 500 });
  }

  let image: string;
  try {
    image = await saveImage(imageBytes, origin);
  } catch (e) {
    if (e instanceof ImageError) return bad(e.message);
    console.error("[launch/prepare] image", e);
    return NextResponse.json({ error: "Could not upload the image — please try again" }, { status: 502 });
  }

  // Put addresses from abandoned launches back into the pool before issuing.
  await reclaimStaleKeys(onChainMints).catch(
    (e) => console.error("[launch/prepare] reclaim", e)
  );

  let key;
  try {
    key = await issueVanityKey(wallet, { name, symbol, description, image, ...socials }, onChainMints);
  } catch (e) {
    if (e instanceof PoolEmptyError) {
      return NextResponse.json({ error: "No launch addresses left — please try again in a few minutes" }, { status: 503 });
    }
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429 });
    console.error("[launch/prepare]", e);
    return NextResponse.json({ error: "Could not prepare launch" }, { status: 500 });
  }

  try {
    const uri = await metadataUri(origin, key.pubkey, metadataJson({ name, symbol, description, image, ...socials }));
    if (byteLen(uri) > MAX_URI_LEN) throw new Error("Metadata URI too long — check NEXT_PUBLIC_SITE_URL");
    const mintKp = Keypair.fromSecretKey(bs58.decode(key.secret));
    const creator = new PublicKey(wallet);
    const [groups, lookup, { blockhash, lastValidBlockHeight }] = await Promise.all([
      buildLaunchInstructions(connection, { mint: mintKp.publicKey, creator, agent, name, symbol, uri, buyLamports }),
      fetchLookupTable(connection),
      connection.getLatestBlockhash("confirmed"),
    ]);
    const txs = packTransactions(groups, creator, blockhash, lookup);
    // Only one atomic transaction is safe: with several, a wallet could send just the
    // create and keep a ...fire coin without the 50/50 split. Needs FIREAGENT_LOOKUP_TABLE.
    if (txs.length !== 1) throw new Error("Launch doesn't fit one transaction — set FIREAGENT_LOOKUP_TABLE");
    for (const tx of txs) {
      const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
      if (signers.some((k) => k.equals(mintKp.publicKey))) tx.sign([mintKp]);
    }
    return NextResponse.json({
      mint: key.pubkey,
      transactions: txs.map((t) => Buffer.from(t.serialize()).toString("base64")),
      lastValidBlockHeight,
    });
  } catch (e) {
    if (e instanceof MainnetRpcError) return NextResponse.json({ error: e.message }, { status: 503 });
    // Nothing was launched with it — give the address back rather than burn it.
    await releaseVanityKey(key.pubkey).catch(() => undefined);
    console.error("[launch/prepare] build", e);
    return NextResponse.json({ error: "Could not prepare the launch — please try again" }, { status: 502 });
  }
}

/** Which of these mints exist on-chain (i.e. were launched). */
async function onChainMints(mints: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk.map((m) => new PublicKey(m)));
    infos.forEach((info, j) => info && out.add(chunk[j]));
  }
  return out;
}

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * Public origin for URLs we publish. In production never derived from the request:
 * the Host header is client-controlled and these URLs end up on-chain permanently.
 */
function siteOrigin(req: Request): string {
  let origin = process.env.NEXT_PUBLIC_SITE_URL;
  if (!origin && process.env.NODE_ENV !== "production") origin = new URL(req.url).origin;
  if (!origin) throw new Error("NEXT_PUBLIC_SITE_URL is not set");
  return origin.replace(/\/$/, "");
}

/**
 * Pin to IPFS when PINATA_JWT is set (survives this server going away);
 * otherwise serve the JSON ourselves from /api/metadata/<mint>.
 */
async function metadataUri(origin: string, mint: string, meta: Record<string, string>): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (jwt) {
    const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pinataContent: meta, pinataMetadata: { name: `${mint}.json` } }),
    });
    if (!res.ok) throw new Error(`Pinata upload failed: ${res.status}`);
    const { IpfsHash } = (await res.json()) as { IpfsHash: string };
    const gateway = process.env.IPFS_GATEWAY || "https://ipfs.io/ipfs";
    return `${gateway}/${IpfsHash}`;
  }
  return `${origin}/api/metadata/${mint}`;
}
