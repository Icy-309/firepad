#!/usr/bin/env node
/**
 * Grind Solana keypairs whose address ends with a suffix (default "fire") and
 * drop them into data/mainnet-beta/vanity/incoming/ — the server pulls them into the pool.
 *
 *   npm run grind                      # 20 keys, all CPU cores
 *   npm run grind -- --count 100 --threads 4
 *
 * Alternative (Rust, same output format, same folder; was slower than this on the dev PC):
 *   cd data/mainnet-beta/vanity/incoming && solana-keygen grind --ends-with fire:100
 *
 * A 4-char case-sensitive suffix needs ~11.3M attempts per key on average:
 * ~5 min per key at ~35k keys/s (8-core desktop, 7 threads).
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import bs58 from "bs58";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

if (isMainThread) {
  const suffix = arg("suffix", process.env.VANITY_SUFFIX || "fire");
  const count = Number(arg("count", 20));
  const threads = Number(arg("threads", cpus().length));
  for (const ch of suffix) {
    if (!ALPHABET.includes(ch)) {
      console.error(`"${ch}" is not a base58 character (no 0, O, I, l).`);
      process.exit(1);
    }
  }

  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "mainnet-beta", "vanity", "incoming");
  mkdirSync(outDir, { recursive: true });
  console.log(`Grinding ${count} keys ending in "${suffix}" on ${threads} threads → ${outDir}`);

  let found = 0;
  let attempts = 0;
  const started = Date.now();
  const workers = Array.from({ length: threads }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { suffix } }));

  const timer = setInterval(() => {
    const secs = (Date.now() - started) / 1000;
    process.stdout.write(`\r${found}/${count} found · ${(attempts / secs / 1000).toFixed(0)}k keys/s · ${secs.toFixed(0)}s   `);
  }, 1000);

  for (const w of workers) {
    w.on("message", (m) => {
      if (m.type === "progress") {
        attempts += m.n;
        return;
      }
      if (found >= count) return;
      found++;
      // Write then rename so the server never reads a half-written keypair (it ingests *.json only).
      const tmp = path.join(outDir, `${m.pubkey}.json.tmp`);
      writeFileSync(tmp, JSON.stringify(m.secret));
      renameSync(tmp, path.join(outDir, `${m.pubkey}.json`));
      console.log(`\n✓ ${m.pubkey}`);
      if (found >= count) {
        clearInterval(timer);
        workers.forEach((x) => x.terminate());
        console.log(`Done: ${found} keys in ${((Date.now() - started) / 1000).toFixed(0)}s`);
      }
    });
  }
} else {
  const { suffix } = workerData;
  // The last k base58 digits of an address are (pubkey as big-endian integer) mod 58^k,
  // so check that residue (cheap) before doing a full base58 encode.
  const MOD = 58 ** suffix.length; // 58^4 = 11,316,496 — small enough for exact float math
  let target = 0;
  for (const ch of suffix) target = target * 58 + ALPHABET.indexOf(ch);

  let n = 0;
  for (;;) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    // JWK export is ~8x faster than DER here (and DER doesn't scale across threads).
    const pub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
    let r = 0;
    for (let i = 0; i < 32; i++) r = (r * 256 + pub[i]) % MOD;
    if (r === target) {
      const address = bs58.encode(pub);
      if (address.endsWith(suffix)) {
        const seed = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url");
        parentPort.postMessage({ type: "found", pubkey: address, secret: [...seed, ...pub] });
      }
    }
    if (++n === 5000) {
      parentPort.postMessage({ type: "progress", n });
      n = 0;
    }
  }
}
