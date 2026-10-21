"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { signRequest } from "@/lib/sign-in";
import { MAX_NAME_LEN, MAX_SYMBOL_LEN } from "@/lib/token-meta";
import { CURVE, INITIAL_CURVE, quoteBuy } from "@/lib/curve";
import { fmtNum } from "@/lib/format";
import { explorerTx } from "@/lib/rpc";
import { friendlyError } from "@/lib/errors";
import { CopyAddress } from "@/components/CopyAddress";
import { useConnectModal } from "@/components/WalletUI";
import { IconCheck, IconChevronDown, IconExternal, IconGift, IconGlobe, IconShield, IconTelegram, IconX_Social } from "@/components/Icons";
import { ImageDrop, type PickedImage } from "@/components/ImageDrop";
import { EMPTY_SOCIALS, normalizeTelegram, normalizeTwitter, normalizeWebsite, type Socials } from "@/lib/socials";
import { Logo } from "@/components/Logo";
import { Embers } from "@/components/Embers";
import { WalletWaitHint } from "@/components/WalletWaitHint";
import { useSendPrepared } from "@/lib/use-send-tx";
import { registerCoin } from "@/lib/register-coin";

const STEPS = ["Sign in with your wallet", "Upload image and reserve …fire address", "Approve in your wallet", "Confirm on-chain", "List on FIREPAD"] as const;
const BUY_PRESETS = ["0.1", "0.5", "1", "2"];
/** Kept back from the max buy for launch rent (~0.03 SOL) and network fees. */
const LAUNCH_RESERVE_SOL = 0.05;
/** pump.fun's trading fee at launch, roughly: only used for the "≈" quote. */
const PUMP_FEE_BPS = 125;

type Status =
  | { step: "idle" }
  | { step: "busy"; index: number }
  | { step: "done"; mint: string; signature: string; bought: number; listed: boolean }
  | { step: "error"; message: string; index: number };

const byteLen = (s: string) => new TextEncoder().encode(s).length;

/** Launch a pump.fun coin with a locked creator-fee split for its holders. */
export function CreateCoin() {
  const { connection } = useConnection();
  const { connected, publicKey, signMessage } = useWallet();
  const sendPrepared = useSendPrepared();
  const { open: openConnect } = useConnectModal();
  const [form, setForm] = useState({ name: "", symbol: "", description: "" });
  const [image, setImage] = useState<PickedImage | null>(null);
  const [socials, setSocials] = useState<Socials>(EMPTY_SOCIALS);
  const [showSocials, setShowSocials] = useState(false);
  const [status, setStatus] = useState<Status>({ step: "idle" });
  const [devBuy, setDevBuy] = useState("");
  const [solBalance, setSolBalance] = useState<number | null>(null);

  // Wallet balance, for the max buy.
  useEffect(() => {
    if (!publicKey) return setSolBalance(null);
    connection
      .getBalance(publicKey)
      .then((l) => setSolBalance(l / LAMPORTS_PER_SOL))
      .catch(() => setSolBalance(null));
  }, [connection, publicKey, status.step]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const nameOk = !!form.name.trim() && byteLen(form.name.trim()) <= MAX_NAME_LEN;
  const symbolOk = !!form.symbol.trim() && byteLen(form.symbol.trim()) <= MAX_SYMBOL_LEN;
  const socialErrors = {
    website: normalizeWebsite(socials.website) === null,
    twitter: normalizeTwitter(socials.twitter) === null,
    telegram: normalizeTelegram(socials.telegram) === null,
  };
  const socialsOk = !socialErrors.website && !socialErrors.twitter && !socialErrors.telegram;
  const buySol = Math.max(0, parseFloat(devBuy) || 0);
  const buyQuote = buySol > 0 ? quoteBuy(INITIAL_CURVE, buySol, PUMP_FEE_BPS) : null;
  const maxBuy = solBalance === null ? null : Math.max(0, solBalance - LAUNCH_RESERVE_SOL);
  const buyOk = devBuy.trim() === "" || (/^\d*\.?\d*$/.test(devBuy.trim()) && (maxBuy === null || buySol <= maxBuy));
  const valid = nameOk && symbolOk && !!image && socialsOk && buyOk;
  const missing = !form.name.trim()
    ? "Add a name"
    : !form.symbol.trim()
      ? "Add a ticker"
      : !image
        ? "Add an image"
        : !socialsOk
          ? "Fix the social links"
          : !buyOk
            ? "Lower the initial buy"
            : "";
  const busy = status.step === "busy";

  async function launch() {
    if (!publicKey || !signMessage) {
      setStatus({ step: "error", index: 0, message: "This wallet can't sign messages. Try Phantom, Solflare or Backpack." });
      return;
    }
    let index = 0;
    try {
      // 1) Prove wallet ownership; the server rate-limits launches per wallet.
      setStatus({ step: "busy", index });
      const signed = await signRequest("launch", publicKey.toBase58(), signMessage);

      // 2) Reserve a pre-ground "...fire" mint address, publish metadata, and build the
      //    pump.fun launch (create, the locked 50/50 fee split, and the optional first buy).
      setStatus({ step: "busy", index: ++index });
      const body = new FormData();
      for (const [k, v] of Object.entries({ ...signed, ...form, ...socials })) body.append(k, v);
      if (buySol > 0) body.append("buySol", String(buySol));
      body.append("image", image!.file, image!.file.name);
      const res = await fetch("/api/launch/prepare", { method: "POST", body });
      const prep = await res.json();
      if (!res.ok) throw new Error(prep.error || "Could not prepare launch");

      // 3) The first buy is in the creating transaction, so nobody can buy before the creator.
      //    Simulated first (a failure shows here, not as a stuck wallet), then signed, sent, confirmed.
      const sigs = await sendPrepared(prep, {
        onApprove: () => setStatus({ step: "busy", index: ++index }),
        onSent: (_sig, i) => i === 0 && setStatus({ step: "busy", index: ++index }),
      });

      // 4) List it, so the agent starts paying holders. The coin is live either way.
      setStatus({ step: "busy", index: ++index });
      const listed = await registerCoin(prep.mint).then(() => true, () => false);
      setStatus({ step: "done", mint: prep.mint as string, signature: sigs[0], bought: buyQuote?.tokens ?? 0, listed });
    } catch (e) {
      setStatus({ step: "error", index, message: friendlyError(e) });
    }
  }

  if (status.step === "done") return <Launched mint={status.mint} signature={status.signature} name={form.name} symbol={form.symbol} image={image?.url ?? ""} bought={status.bought} listed={status.listed} />;

  return (
      <div className="reveal grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Form */}
        <div className="card space-y-5 p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" hint={`${byteLen(form.name.trim())}/${MAX_NAME_LEN}`} error={!!form.name && !nameOk}>
              <input className="inp" value={form.name} onChange={set("name")} placeholder="e.g. Solar Cat" maxLength={64} />
            </Field>
            <Field label="Ticker" hint={`${form.symbol.length}/${MAX_SYMBOL_LEN}`}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                <input
                  className="inp pl-7 uppercase"
                  value={form.symbol}
                  onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase().replace(/\s/g, "").slice(0, MAX_SYMBOL_LEN) }))}
                  placeholder="SCAT"
                />
              </div>
            </Field>
          </div>

          <Field label="Description" hint="optional">
            <textarea
              className="inp min-h-28 resize-y"
              value={form.description}
              onChange={set("description")}
              placeholder="Tell people what your coin is about"
              maxLength={1000}
            />
          </Field>

          <Field label="Image" as="div">
            <ImageDrop value={image} onChange={setImage} disabled={busy} />
          </Field>

          {/* Socials (optional) */}
          <div className="rounded-xl border border-line">
            <button
              type="button"
              onClick={() => setShowSocials((v) => !v)}
              aria-expanded={showSocials}
              className="flex w-full items-center justify-between px-4 py-3 text-sm"
            >
              <span className="font-medium">
                Socials <span className="font-normal text-muted">(optional)</span>
              </span>
              <span className="flex items-center gap-2 text-muted">
                <span className="flex items-center gap-1.5">
                  <IconGlobe className={`h-4 w-4 ${socials.website ? "text-sol" : ""}`} />
                  <IconX_Social className={`h-3.5 w-3.5 ${socials.twitter ? "text-sol" : ""}`} />
                  <IconTelegram className={`h-4 w-4 ${socials.telegram ? "text-sol" : ""}`} />
                </span>
                <IconChevronDown className={`h-4 w-4 transition ${showSocials ? "rotate-180" : ""}`} />
              </span>
            </button>
            {showSocials && (
              <div className="animate-fade-in space-y-3 border-t border-line p-4">
                <SocialInput
                  icon={<IconGlobe className="h-4 w-4" />}
                  label="Website"
                  placeholder="mycoin.xyz"
                  value={socials.website}
                  error={socialErrors.website}
                  onChange={(v) => setSocials((s) => ({ ...s, website: v }))}
                />
                <SocialInput
                  icon={<IconX_Social className="h-3.5 w-3.5" />}
                  label="X"
                  placeholder="@handle or x.com/handle"
                  value={socials.twitter}
                  error={socialErrors.twitter}
                  onChange={(v) => setSocials((s) => ({ ...s, twitter: v }))}
                />
                <SocialInput
                  icon={<IconTelegram className="h-4 w-4" />}
                  label="Telegram"
                  placeholder="t.me/group"
                  value={socials.telegram}
                  error={socialErrors.telegram}
                  onChange={(v) => setSocials((s) => ({ ...s, telegram: v }))}
                />
              </div>
            )}
          </div>

          {/* Initial buy (optional) */}
          <div className="rounded-xl border border-line p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">
                Buy at launch <span className="font-normal text-muted">(optional)</span>
              </span>
              {solBalance !== null && <span className="text-[11px] text-muted">Balance {solBalance.toFixed(3)} SOL</span>}
            </div>
            <p className="mt-0.5 text-xs text-muted">Be the first buyer. It happens in the same transaction, so nobody can buy before you.</p>
            <div
              className={`mt-3 flex items-center rounded-xl border bg-ink px-3.5 transition focus-within:ring-2 ${
                buyOk ? "border-line focus-within:border-brand focus-within:ring-brand/20" : "border-down focus-within:ring-down/20"
              }`}
            >
              <input
                inputMode="decimal"
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.0"
                disabled={busy}
                className="w-full bg-transparent py-2.5 text-lg font-semibold outline-none placeholder:text-muted/50"
                aria-label="Initial buy in SOL"
              />
              <span className="text-sm font-semibold text-muted">SOL</span>
            </div>
            <div className="mt-2 flex gap-1.5">
              {BUY_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={busy}
                  onClick={() => setDevBuy(devBuy === p ? "" : p)}
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition ${
                    devBuy === p ? "border-sol/50 bg-sol/10 text-sol" : "border-line text-muted hover:text-white"
                  }`}
                >
                  {p} SOL
                </button>
              ))}
            </div>
            {buyQuote && buyOk && (
              <p className="mt-2.5 text-xs text-muted">
                You get <span className="font-semibold text-white">≈ {fmtNum(Math.round(buyQuote.tokens))} {form.symbol || "tokens"}</span> (
                {((buyQuote.tokens / CURVE.totalSupply) * 100).toFixed(2)}% of supply)
                {buyQuote.capped && " — that buys out the whole curve"}.
              </p>
            )}
            {!buyOk && (
              <p className="mt-2.5 text-xs text-down">
                {maxBuy !== null && buySol > maxBuy
                  ? `Max ${maxBuy.toFixed(3)} SOL. Keep about ${LAUNCH_RESERVE_SOL} SOL for the launch itself.`
                  : "Enter a valid amount."}
              </p>
            )}
          </div>

          {/* Launch steps */}
          {(busy || status.step === "error") && (
            <ol className="space-y-2 rounded-xl border border-line bg-ink/60 p-3.5 text-sm">
              {STEPS.map((label, i) => {
                const cur = status.index;
                const state = i < cur ? "done" : i === cur ? (status.step === "error" ? "error" : "active") : "todo";
                return (
                  <li key={label} className="flex items-center gap-2.5">
                    <span
                      className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                        state === "done"
                          ? "bg-sol text-black"
                          : state === "active"
                            ? "border-2 border-brand border-t-transparent animate-spin"
                            : state === "error"
                              ? "bg-down text-white"
                              : "border border-line text-muted"
                      }`}
                    >
                      {state === "done" ? <IconCheck className="h-3 w-3" /> : state === "error" ? "!" : state === "todo" ? i + 1 : ""}
                    </span>
                    <span className={state === "todo" ? "text-muted" : "text-white"}>{label}</span>
                  </li>
                );
              })}
              {status.step === "error" && <li className="pt-1 text-xs text-down">{status.message}</li>}
            </ol>
          )}
          <WalletWaitHint active={busy && status.step === "busy" && status.index === 2} />

          <button
            disabled={connected && (!valid || busy)}
            onClick={connected ? launch : openConnect}
            className="btn-primary w-full py-3.5 text-base"
          >
            {!connected
              ? "Connect wallet to create"
              : busy
                ? STEPS[status.index] + "…"
                : missing || (status.step === "error" ? "Try again" : buySol > 0 ? `Create coin and buy ${buySol} SOL` : "Create coin")}
          </button>
          <p className="text-center text-xs text-muted">
            Your coin&apos;s details and the 50/50 split can&apos;t be changed after launch. There&apos;s no launch fee, only Solana&apos;s small network cost.
          </p>
        </div>

        {/* Preview */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="card p-4">
            <div className="text-xs font-medium text-muted">Preview</div>
            <div className="mt-3 flex gap-3">
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-panel2">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Logo size={40} className="opacity-60" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{form.name || "Coin name"}</div>
                <div className="text-sm text-muted">{form.symbol ? `$${form.symbol}` : "$TICKER"}</div>
                <div className="mt-1 line-clamp-2 text-xs text-muted">{form.description || "Your description shows here."}</div>
                {(socials.website || socials.twitter || socials.telegram) && (
                  <div className="mt-1.5 flex items-center gap-2 text-muted">
                    {socials.website && <IconGlobe className="h-3.5 w-3.5" />}
                    {socials.twitter && <IconX_Social className="h-3 w-3" />}
                    {socials.telegram && <IconTelegram className="h-3.5 w-3.5" />}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-dashed border-line px-3 py-2 font-mono text-xs text-muted">
              CA ••••••••••••••••••••••••••••••••••<span className="font-semibold text-sol">fire</span>
            </div>
          </div>

          <div className="card space-y-3 p-4 text-sm">
            <Perk icon={<IconGift className="h-4 w-4" />} title="You earn 50% of creator fees">
              Every trade on pump.fun pays a creator fee. pump.fun sends half of it straight to you.
            </Perk>
            <Perk icon={<IconShield className="h-4 w-4" />} title="Holders earn the other 50%">
              The agent pays the other half to holders by balance, so your community is rewarded for holding.
            </Perk>
            <Perk icon={<IconShield className="h-4 w-4" />} title="Locked by pump.fun">
              The split is set in pump.fun&apos;s own fee sharing and locked at launch. Nobody can change it, us included.
            </Perk>
            <Perk icon={<IconX_Social className="h-3.5 w-3.5" />} title="Marketing on autopilot">
              Your coin gets an X thread, captions and a TikTok-ready video, and the agent posts your milestones.
            </Perk>
            <Perk icon={<span className="font-mono text-[10px] font-bold">fire</span>} title="A …fire address">
              Every coin gets a contract address ending in fire.
            </Perk>
          </div>
        </div>
      </div>
  );
}

function Launched({
  mint,
  signature,
  name,
  symbol,
  image,
  bought,
  listed: listedAtLaunch,
}: {
  mint: string;
  signature: string;
  name: string;
  symbol: string;
  image: string;
  bought: number;
  listed: boolean;
}) {
  const [listed, setListed] = useState(listedAtLaunch);
  const [retrying, setRetrying] = useState(false);
  const [listError, setListError] = useState("");
  async function retryListing() {
    setRetrying(true);
    setListError("");
    try {
      await registerCoin(mint);
      setListed(true);
    } catch (e) {
      setListError(friendlyError(e));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-lg animate-pop-in pt-6 text-center">
      <Embers count={34} />
      <div className="relative mx-auto h-24 w-24">
        <div className="absolute inset-0 animate-ping rounded-full bg-sol/20" />
        <div className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-full border border-line bg-panel">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-full w-full object-cover" />
          ) : (
            <Logo size={56} className="flame-glow" />
          )}
        </div>
      </div>
      <h1 className="mt-5 font-display text-3xl font-bold">{name || "Your coin"} is live</h1>
      <p className="mt-1 text-muted">${symbol} is trading on pump.fun now.</p>
      {bought > 0 && (
        <p className="mt-2 text-sm">
          You bought <span className="font-semibold text-sol">≈ {fmtNum(Math.round(bought))} {symbol}</span> at launch.
        </p>
      )}

      {!listed && (
        <div className="mt-5 rounded-xl border border-down/50 bg-down/10 p-3 text-left text-sm">
          <p className="text-down">
            The coin is live, but it isn&apos;t listed on FIREPAD yet, so holders won&apos;t be paid until it is.
          </p>
          {listError && <p className="mt-1 text-xs text-down">{listError}</p>}
          <button onClick={retryListing} disabled={retrying} className="btn-secondary mt-2.5 px-4 py-2 text-sm">
            {retrying ? "Listing…" : "List it now"}
          </button>
        </div>
      )}

      <div className="card mt-6 p-4 text-left">
        <div className="text-xs text-muted">Contract address</div>
        <CopyAddress address={mint} full label="" className="mt-1.5 w-full justify-between !py-2 !text-sm" />
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href={`/token/${mint}`} className="btn-primary px-6 py-3">
          View coin
        </Link>
        <Link href={`/token/${mint}#marketing`} className="btn-secondary px-6 py-3">
          Get your marketing kit
        </Link>
        <a href={explorerTx(signature)} target="_blank" rel="noreferrer" className="btn-secondary px-6 py-3">
          Transaction <IconExternal className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  as: Tag = "label",
  children,
}: {
  label: string;
  hint?: string;
  error?: boolean;
  /** "div" when the child brings its own <label> (labels can't nest). */
  as?: "label" | "div";
  children: React.ReactNode;
}) {
  return (
    <Tag className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className={`text-[11px] ${error ? "text-down" : "text-muted"}`}>{hint}</span>}
      </div>
      {children}
    </Tag>
  );
}

function SocialInput({
  icon,
  label,
  placeholder,
  value,
  error,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  value: string;
  error: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <div
        className={`flex items-center gap-2.5 rounded-xl border bg-ink px-3.5 transition focus-within:ring-2 ${
          error ? "border-down focus-within:ring-down/20" : "border-line focus-within:border-brand focus-within:ring-brand/20"
        }`}
      >
        <span className="text-muted">{icon}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted/60"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error && <span className="mt-1 block text-xs text-down">That doesn&apos;t look like a valid {label} link.</span>}
    </label>
  );
}

function Perk({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sol/10 text-sol">{icon}</div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-xs leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  );
}
