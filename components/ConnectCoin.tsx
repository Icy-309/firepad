"use client";

import { useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSendPrepared } from "@/lib/use-send-tx";
import { registerCoin } from "@/lib/register-coin";
import { friendlyError } from "@/lib/errors";
import { shortAddr } from "@/lib/format";
import { explorerTx } from "@/lib/rpc";
import { useConnectModal } from "@/components/WalletUI";
import { WalletWaitHint } from "@/components/WalletWaitHint";
import { Logo } from "@/components/Logo";
import { IconExternal, IconGift, IconShield } from "@/components/Icons";

/** Mirrors SplitStatus in lib/server/pump.ts. */
type Split =
  | { status: "not-pump" }
  | { status: "none"; creator: string; graduated: boolean }
  | { status: "unset"; creator: string; graduated: boolean; shareholders: string[] }
  | { status: "active"; creator: string; locked: boolean; graduated: boolean }
  | { status: "other"; graduated: boolean };

interface Info {
  name: string;
  symbol: string;
  description: string;
  image: string;
}

type Status =
  | { step: "idle" }
  | { step: "busy"; label: string }
  | { step: "done"; signature: string | null }
  | { step: "error"; message: string };

/** Connect an existing pump.fun coin and split its creator fee with holders. */
export function ConnectCoin() {
  const { connected, publicKey } = useWallet();
  const { open: openConnect } = useConnectModal();
  const sendPrepared = useSendPrepared();
  const [ca, setCa] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [coin, setCoin] = useState<{ mint: string; split: Split; info: Info | null } | null>(null);
  const [status, setStatus] = useState<Status>({ step: "idle" });

  async function check(e?: React.FormEvent) {
    e?.preventDefault();
    const mint = ca.trim();
    setCoin(null);
    setCheckError("");
    setStatus({ step: "idle" });
    try {
      new PublicKey(mint);
    } catch {
      return setCheckError("That isn't a valid contract address.");
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/connect/check?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't look up that coin");
      setCoin({ mint, split: body.split, info: body.info ?? null });
    } catch (err) {
      setCheckError(friendlyError(err));
    } finally {
      setChecking(false);
    }
  }

  async function connectCoin() {
    if (!coin || !publicKey) return;
    try {
      setStatus({ step: "busy", label: "Building the transaction" });
      const res = await fetch("/api/connect/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint: coin.mint, wallet: publicKey.toBase58() }),
      });
      const prep = await res.json();
      if (!res.ok) throw new Error(prep.error || "Couldn't build the transaction");
      const [signature] = await sendPrepared(prep, {
        onApprove: () => setStatus({ step: "busy", label: "Approve in your wallet" }),
        onSent: () => setStatus({ step: "busy", label: "Confirming on-chain" }),
      });
      setStatus({ step: "busy", label: "Listing on FIREPAD" });
      await registerCoin(coin.mint);
      setStatus({ step: "done", signature });
    } catch (err) {
      setStatus({ step: "error", message: friendlyError(err) });
    }
  }

  async function listOnly() {
    if (!coin) return;
    try {
      setStatus({ step: "busy", label: "Listing on FIREPAD" });
      await registerCoin(coin.mint);
      setStatus({ step: "done", signature: null });
    } catch (err) {
      setStatus({ step: "error", message: friendlyError(err) });
    }
  }

  if (coin && status.step === "done") {
    return (
      <div className="mx-auto max-w-lg animate-pop-in pt-6 text-center">
        <CoinAvatar info={coin.info} size="lg" />
        <h1 className="mt-5 font-display text-3xl font-bold">{coin.info?.name || "Your coin"} is on FIREPAD</h1>
        <p className="mt-1 text-muted">
          Half of its creator fee now goes to holders. The agent pays them out as fees build up.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={`/token/${coin.mint}`} className="btn-primary px-6 py-3">
            View coin
          </Link>
          <Link href={`/token/${coin.mint}#marketing`} className="btn-secondary px-6 py-3">
            Get your marketing kit
          </Link>
          {status.signature && (
            <a href={explorerTx(status.signature)} target="_blank" rel="noreferrer" className="btn-secondary px-6 py-3">
              Transaction <IconExternal className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    );
  }

  const busy = status.step === "busy";
  const split = coin?.split;
  const creator = split && "creator" in split ? split.creator : null;
  const isCreator = !!creator && publicKey?.toBase58() === creator;

  return (
    <div className="reveal grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="card space-y-5 p-5 sm:p-6">
        <form onSubmit={check}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Contract address</span>
            <div className="flex gap-2">
              <input
                className="inp font-mono text-sm"
                value={ca}
                onChange={(e) => setCa(e.target.value.trim())}
                placeholder="Your pump.fun coin's CA"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              <button type="submit" className="btn-secondary shrink-0 px-4" disabled={!ca || checking || busy}>
                {checking ? "Checking…" : "Check"}
              </button>
            </div>
          </label>
          {checkError && <p className="mt-2 text-xs text-down">{checkError}</p>}
        </form>

        {coin && split && (
          <div className="animate-fade-in space-y-4">
            <div className="flex gap-3 rounded-xl border border-line p-3">
              <CoinAvatar info={coin.info} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{coin.info?.name || shortAddr(coin.mint)}</div>
                {coin.info?.symbol && <div className="text-sm text-muted">${coin.info.symbol}</div>}
                {creator && <div className="mt-0.5 text-xs text-muted">Creator {shortAddr(creator)}</div>}
              </div>
            </div>

            {split.status === "not-pump" && <Note tone="bad">That address isn&apos;t a pump.fun coin.</Note>}
            {split.status === "other" && (
              <Note tone="bad">
                This coin&apos;s creator fee is already shared another way, and pump.fun doesn&apos;t allow changing that.
              </Note>
            )}
            {split.status === "active" && (
              <>
                <Note tone="good">This coin is already connected to FIREPAD with a 50/50 split.</Note>
                <button onClick={listOnly} disabled={busy} className="btn-primary w-full py-3.5 text-base">
                  {busy ? status.label + "…" : "Open its page"}
                </button>
              </>
            )}
            {(split.status === "none" || split.status === "unset") && (
              <>
                {!connected ? (
                  <button onClick={openConnect} className="btn-primary w-full py-3.5 text-base">
                    Connect the creator wallet
                  </button>
                ) : !isCreator ? (
                  <Note tone="bad">
                    Only the coin&apos;s creator can connect it. Switch to the wallet {shortAddr(creator!)}.
                  </Note>
                ) : (
                  <>
                    <Note tone="warn">
                      This is permanent. pump.fun locks the split once it&apos;s set, so nobody can
                      change it later.
                    </Note>
                    <button onClick={connectCoin} disabled={busy} className="btn-primary w-full py-3.5 text-base">
                      {busy ? status.label + "…" : "Split my creator fee with holders"}
                    </button>
                    <WalletWaitHint active={busy && status.label === "Approve in your wallet"} />
                  </>
                )}
              </>
            )}
            {status.step === "error" && <p className="text-xs text-down">{status.message}</p>}
          </div>
        )}
      </div>

      <div className="card space-y-3 self-start p-4 text-sm lg:sticky lg:top-20">
        <Perk icon={<IconGift className="h-4 w-4" />} title="Holders earn half your creator fee">
          pump.fun keeps paying you 50% directly. The other 50% is paid out to your holders by how much they hold.
        </Perk>
        <Perk icon={<IconShield className="h-4 w-4" />} title="Enforced by pump.fun">
          The split uses pump.fun&apos;s own fee sharing, and pump.fun locks it. Your half is paid directly to you.
        </Perk>
        <Perk icon={<Logo size={16} />} title="Marketing included">
          Your coin gets an X thread, captions and a TikTok-ready video, and the agent posts your milestones.
        </Perk>
      </div>
    </div>
  );
}

function CoinAvatar({ info, size = "sm" }: { info: Info | null; size?: "sm" | "lg" }) {
  const cls = size === "lg" ? "mx-auto h-24 w-24 rounded-full" : "h-14 w-14 rounded-xl";
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden border border-line bg-panel2 ${cls}`}>
      {info?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={info.image} alt="" className="h-full w-full object-cover" />
      ) : (
        <Logo size={size === "lg" ? 56 : 28} className="opacity-60" />
      )}
    </div>
  );
}

function Note({ tone, children }: { tone: "good" | "bad" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "good"
      ? "border-sol/40 bg-sol/10 text-sol"
      : tone === "bad"
        ? "border-down/50 bg-down/10 text-down"
        : "border-brand/40 bg-brand/10 text-white";
  return <p className={`rounded-xl border p-3 text-sm ${cls}`}>{children}</p>;
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
