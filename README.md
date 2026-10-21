# FIREPAD

pump.fun coins that pay their holders. Each coin's **creator fee is split 50/50** between its creator
and the FIREAGENT payout wallet using pump.fun's own fee sharing, which pump.fun locks once set. The agent
pays its half out to the coin's holders by balance. Coins launched here get a contract address ending
in **`fire`**; existing pump.fun coins can be connected by their creator.

## Run it

```bash
npm install
cp .env.example .env.local      # see "Config" below
npm run grind -- --count 20     # pre-grind "...fire" mint addresses (see below)
npm run fireagent:lut           # mainnet: lookup table so a launch + first buy fits one transaction
npm run dev                     # http://localhost:3000  (admin panel: /admin)
npm run fireagent               # the agent: distributes creator fees and pays holders
npm run marketing               # the marketing agent: Launch Kits and X posts
```

The app and transaction endpoints are **mainnet-beta only**. Set `RPC_URL` to a mainnet provider
before use. The server verifies the network before forwarding wallet RPC requests or preparing
transactions. The public mainnet endpoint is rate limited and does not support the payout agent's
holder-account scans.

## Hosting

Use GitHub for the source repository and deploy the app to a persistent Node.js server, such as a
single VPS. GitHub Pages serves static files only and cannot run this app's Next.js API routes,
wallet transaction preparation, or JSON-backed stores.

Render Free can host a preview, but it is not a VPS and is not suitable for live mainnet use: free
services can sleep, and their filesystem is ephemeral. A restart or redeploy can lose uploaded
images, vanity keys, coin records, and payout state. For production, use a continuously available
service with persistent storage; a serverless or multi-instance deployment also needs a database
and object storage first.

For a persistent single-server deployment, configure the production environment from `.env.example`,
set `NEXT_PUBLIC_SITE_URL` to the HTTPS domain, build the app, and run `npm start` behind a
TLS-terminating reverse proxy. Keep `.env.local`, wallet keypairs, and `data/` out of Git.

## What's here

```
app/
  page.tsx                  # home: ticker, hero, trending carousel, filterable coin feed, search (?q=)
  create/page.tsx           # "New coin" (CreateCoin) and "Existing coin" (ConnectCoin, ?mode=connect)
  token/[mint]/page.tsx     # coin page: stats, fee split, holder payouts, Launch Kit, link to pump.fun
  how-it-works/page.tsx     # steps, fees, FAQ
  admin/page.tsx            # admin panel (wallet sign-in)
  api/auth/nonce            # GET: one-time nonce for Sign-In With Solana messages
  api/launch/prepare        # POST (multipart): signed request + image -> pump.fun launch txs, co-signed by the ...fire mint
  api/connect/check         # GET ?mint=: a coin's name/image and its fee-split status
  api/connect/prepare       # POST: the creator's unsigned tx that sets the 50/50 split
  api/coins/register        # POST: list a coin once its split is on chain (the split is the proof)
  api/metadata/[mint]       # GET: off-chain metadata JSON (pump.fun format, socials included)
  api/image/[file]          # GET: uploaded coin images (content-addressed)
  api/agent/*               # Launch Kits, creator X linking
  api/admin/*               # login/logout, state, hide/unhide, vanity key import
components/
  CreateCoin ConnectCoin LaunchKit VideoMaker TokenCard WalletUI ...
lib/
  fireagent.ts              # brand, 50/50 split, public agent wallet
  curve.ts                  # pump.fun curve math (quotes and display)
  register-coin.ts          # client: list a coin after its split lands (retries while the RPC catches up)
  use-send-tx.ts            # simulate -> sign (all at once) -> send -> confirm, for server-built txs
  server/pump.ts            # launch/connect instructions, split status, curve reads, tx packing
  server/fireagent-store.ts # one JSON file per coin: payouts, holder pool (data/mainnet-beta/fireagent/coins/)
  server/tokens.ts          # listed coins + their live pump.fun curves
  server/coin-info.ts       # name/image/socials for any pump.fun coin
  server/store.ts           # vanity pool, launch metadata, moderation
  server/agent/*            # marketing agent
scripts/
  fireagent.ts              # the payout agent
  fireagent-lut.ts          # creates the address lookup table
  fireagent-e2e.ts          # devnet end-to-end test on the real pump.fun programs
  agent.ts                  # marketing agent
  grind-vanity.mjs          # multi-core "...fire" keypair grinder
_legacy/                    # the earlier custom-program version (not built; see _legacy/README.md)
anchor/                     # that version's on-chain program (not used)
```

## How the fees flow

1. Every pump.fun trade pays the coin's creator fee (rate set by pump.fun), on the curve and on
   PumpSwap after graduation.
2. On launch (or connect), pump-fees `create_fee_sharing_config` + `update_fee_shares` set the
   coin's shareholders to **creator 50% / FIREAGENT wallet 50%**. pump.fun locks the config, so
   nobody, us included, can change it afterwards.
3. The agent cranks `distribute_creator_fees` once pump.fun says enough has built up. pump.fun pays
   the creator's half directly; the agent measures what reached its own wallet from that
   transaction's balance changes and credits it to the coin's holder pool.
4. When a pool reaches `FIREAGENT_MIN_PAYOUT_SOL`, the agent snapshots wallet holders (on-curve
   owners only, so pools and the bonding curve are skipped; the creator and the agent are excluded),
   keeps those holding at least `FIREAGENT_MIN_HOLD_PCT` of supply (default 0.1%), takes the largest `FIREAGENT_MAX_HOLDERS`, splits by balance, drops shares under
   `FIREAGENT_MIN_SHARE_SOL`, and sends plain SOL transfers in batches. The pool is reduced after
   each confirmed batch, so a crash never pays anyone twice. Network fees come out of the pool.

Every payout is recorded with its signatures and shown on the coin's page.

## Launching a coin

The form takes a name, ticker, description, an **image (required)**, **socials (optional)** and an
optional first buy.

1. The wallet signs a Sign-In With Solana message (domain + one-time nonce).
2. `POST /api/launch/prepare` verifies it, checks rate limits and the wallet's balance, stores the
   image, reserves a `...fire` keypair, publishes the metadata JSON, and builds the launch:
   `create_v2` + first buy + the locked 50/50 split. With `FIREAGENT_LOOKUP_TABLE` set it's one
   transaction, so nobody can buy between creation and the creator's buy; without it, 2-3
   transactions approved in one wallet popup. **Set the lookup table in production**: the create
   page promises the first buy can't be front-run.
3. The server co-signs with the mint key; the wallet signs and the browser sends them in order.
4. The browser calls `/api/coins/register`, which checks the split on chain and lists the coin.

## Connecting an existing coin

`/create?mode=connect`: paste a CA. `/api/connect/check` reports the split status:
`none` / `unset` (connectable by the creator / config admin), `active` (already connected),
`other` (shared some other way; pump.fun won't allow changing it), `not-pump`. The creator signs
the transaction from `/api/connect/prepare` (it sweeps fees left on the curve first if needed),
then the coin is registered.

## Vanity "...fire" mint addresses

Addresses can't be chosen, only searched for, so a pool is pre-ground (like pump.fun's "...pump"):

1. **Grind** keypairs into `data/mainnet-beta/vanity/incoming/`:
   - `npm run grind -- --count 100 [--threads N]` — Node, ~5 min per key on 8 cores
   - `cd data/mainnet-beta/vanity/incoming && solana-keygen grind --ends-with fire:100` — same output format (on the dev PC it was slower than the Node grinder)
   - or upload keypair JSON files in the admin panel
2. The server pulls new files into the pool (`data/mainnet-beta/store.json`) on the next launch or admin visit.
   The grinder writes atomically, and only files that parse are removed from `incoming/`.
3. Each launch takes one address. Limits stop anyone from draining the pool: per wallet
   (`VANITY_MAX_PER_HOUR`), per IP (`VANITY_MAX_PER_IP_HOUR`), pool-wide (`VANITY_MAX_PER_MINUTE`),
   and a minimum wallet balance (`VANITY_MIN_BALANCE_SOL`).
4. An address whose launch never happens goes back into the pool after 30 minutes (long after its
   transactions' blockhash has expired). The mint secret never leaves the server: it co-signs the
   launch transactions before they are sent to the wallet.

`data/mainnet-beta/` holds secret keys and is git-ignored. It is kept separate from old devnet data.
The store is a JSON file — fine for a single server
(`next start` on a VPS). **On serverless hosts the disk is ephemeral**, and in-process locks and rate
limits don't span instances; move `lib/server/store.ts` and `rate-limit.ts` to Postgres/Redis first.


## Marketing agent (`npm run marketing`)

Fully automatic community marketing for every launch.

- **Launch Kit** (every coin page, "Launch Kit" section): lore, tagline, an X launch thread, captions,
  and a 15-second vertical video for TikTok / Reels / Shorts rendered in the browser (coin art, the
  market cap climb since launch, the fee pitch, "CA ends in fire"). Copy or "Post on X" in one click.
- **X bot**: posts launches and on-chain milestones (market cap steps, curve 50/75/90%, graduation,
  holder earnings) from the official FIREPAD account, and from the creator's
  own X if they connected it on their coin page (their launch post is their kit thread).
- **Writer**: Claude (`claude-opus-5-5`, structured outputs, server-side refusal fallback) when
  `ANTHROPIC_API_KEY` is set; built-in templates otherwise.
- **Guardrails**: no price predictions, promises or urgency; every number comes from on-chain facts;
  hidden coins are never promoted; rate limits per account; only the highest milestone crossed is posted.
- **Without X keys** it's a dry run: posts are logged to `/admin` → Marketing agent.
- Creator X tokens are stored encrypted (AES-256-GCM). Linking requires a wallet signature, so only the
  coin's creator can connect their X to it.

## Admin panel (`/admin`)

Sign in with a wallet listed in `ADMIN_WALLETS` (Sign-In With Solana; session = HMAC-signed,
httpOnly, SameSite=Strict cookie, 12h).

- **FIREPAD:** coins, fees distributed, holder pools and payouts, agent health.
- **Vanity pool:** addresses left (warns below 10), recently issued, keypair upload.
- **Moderation:** hide/unhide coins from the feed. Trading on pump.fun and holder payouts continue.
- **Marketing agent:** posts and dry-run log.

## Config

See `.env.example`. The essentials: `NEXT_PUBLIC_SITE_URL`, a mainnet-beta `RPC_URL` (Helius/Triton/QuickNode: the
agent needs `getProgramAccounts` on the token programs), `NEXT_PUBLIC_FIREAGENT_WALLET` +
`FIREAGENT_KEYPAIR`, `FIREAGENT_LOOKUP_TABLE`, `ADMIN_WALLETS` + `ADMIN_SESSION_SECRET`.

## Security notes

- Signed requests use Sign-In With Solana: domain (checked against `NEXT_PUBLIC_SITE_URL`), cluster,
  5-minute freshness and a single-use server nonce. Wallets warn when the domain doesn't match.
- `NEXT_PUBLIC_SITE_URL` must be set in production; published URLs are never built from the request's
  Host header there.
- Uploaded images are identified by their bytes, stored under their SHA-256, and served with
  `nosniff` and a sandboxing CSP. They only arrive with a signed launch.
- Pages send `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, a referrer policy.
- The site shows a coin's on-chain name and ticker, and only shows stored descriptions, images and
  socials when the on-chain creator is the wallet that reserved the address. Connected coins take
  theirs from the coin's own metadata JSON (https only, no redirects, size-capped).
- The agent keypair (`FIREAGENT_KEYPAIR`) is only loaded by `npm run fireagent`, never by the web app.
  It only ever holds the holders' half, between a distribution and the next payout.


## Testing

`scripts/fireagent-e2e.ts` is a separate devnet-only flow against the real pump.fun programs:
launch with the locked split -> another wallet trades -> distribution -> creator and agent each get
half. It uses `E2E_RPC_URL` (or the public devnet endpoint) and refuses non-devnet RPCs, so a
mainnet `RPC_URL` cannot accidentally redirect the test. Needs devnet-funded `E2E_FUNDER` and
`FIREAGENT_KEYPAIR` wallets; costs about 0.1 devnet SOL.

## Roadmap

1. **Indexer:** 24h change, volume and price history (e.g. Helius webhooks -> Postgres).
2. **Scale-out:** move the stores, nonces and rate limits to Postgres/Redis before running more than
   one server.
3. **Production readiness:** provision the mainnet RPC, payout wallet and lookup table, then monitor
   the agent from `/admin` before enabling launches.

> Memecoins are risky. The live app uses mainnet and can submit real transactions. The optional
> end-to-end test is devnet-only; never fund its wallets with mainnet SOL.
