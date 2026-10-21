"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VideoMaker } from "./VideoMaker";
import { IconCheck, IconCopy, IconX_Social } from "./Icons";
import { signRequest } from "@/lib/sign-in";
import { friendlyError } from "@/lib/errors";

interface Kit {
  tagline: string;
  lore: string;
  thread: string[];
  captions: string[];
  videoLines: string[];
  generatedBy: "claude" | "template";
}

const TABS = ["X thread", "Captions", "Lore", "Video"] as const;
type Tab = (typeof TABS)[number];

/** AI-written marketing for a coin: X thread, captions, lore and a vertical video, plus X auto-posting for its creator. */
export function LaunchKit({
  mint,
  name,
  symbol,
  image,
  creator,
  mcUsd,
  launchMcUsd,
}: {
  mint: string;
  name: string;
  symbol: string;
  image: string;
  creator: string;
  mcUsd: number;
  launchMcUsd: number;
}) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("X thread");

  useEffect(() => {
    let stop = false;
    fetch(`/api/agent/kit/${mint}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((k) => !stop && setKit(k))
      .catch(() => !stop && setError(true));
    return () => {
      stop = true;
    };
  }, [mint]);

  // Chart for the video: the climb from launch to today's market cap. There's no trade
  // history without an indexer, so it shows the path only, never individual trades.
  const points = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        mc: launchMcUsd * Math.pow(Math.max(mcUsd, launchMcUsd) / launchMcUsd, i / 23),
        side: "buy" as const,
        sol: 0,
      })),
    [launchMcUsd, mcUsd]
  );

  return (
    <section id="marketing" className="card scroll-mt-24 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Launch Kit</h2>
          <p className="text-xs text-muted">{kit?.tagline ?? "Marketing for this coin, written by FIREPAD."}</p>
        </div>
      </div>

      <CreatorX creator={creator} mint={mint} />

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`tab whitespace-nowrap ${tab === t ? "tab-active" : ""}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="p-4">
        {!kit && !error && <p className="py-6 text-center text-sm text-muted">The agent is writing this coin&apos;s kit…</p>}
        {error && <p className="py-6 text-center text-sm text-down">Couldn&apos;t load the Launch Kit. Refresh to try again.</p>}
        {kit && tab === "X thread" && (
          <ol className="space-y-3">
            {kit.thread.map((p, i) => (
              <Post key={i} text={p} label={`${i + 1}/${kit.thread.length}`} />
            ))}
          </ol>
        )}
        {kit && tab === "Captions" && (
          <ul className="space-y-3">
            {kit.captions.map((p, i) => (
              <Post key={i} text={p} />
            ))}
          </ul>
        )}
        {kit && tab === "Lore" && (
          <div className="space-y-3">
            <p className="whitespace-pre-line text-sm leading-relaxed">{kit.lore}</p>
            <CopyButton text={kit.lore} />
          </div>
        )}
        {kit && tab === "Video" && <VideoMaker mint={mint} name={name} symbol={symbol} image={image} lines={kit.videoLines} points={points} />}
      </div>
    </section>
  );
}

function Post({ text, label }: { text: string; label?: string }) {
  const intent = useMemo(() => `https://x.com/intent/post?text=${encodeURIComponent(text)}`, [text]);
  return (
    <li className="list-none rounded-xl border border-line bg-ink/60 p-3">
      {label && <div className="mb-1 text-[11px] font-semibold text-muted">{label}</div>}
      <p className="whitespace-pre-line break-words text-sm leading-relaxed">{text}</p>
      <div className="mt-2.5 flex gap-2">
        <CopyButton text={text} />
        <a href={intent} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:text-white">
          <IconX_Social className="h-3 w-3" /> Post on X
        </a>
      </div>
    </li>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:text-white"
    >
      {done ? <IconCheck className="h-3.5 w-3.5 text-sol" /> : <IconCopy className="h-3.5 w-3.5" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** For the coin's creator: link their own X so the agent announces launches and milestones there too. */
function CreatorX({ creator, mint }: { creator: string; mint: string }) {
  const { publicKey, signMessage } = useWallet();
  const isCreator = !!publicKey && publicKey.toBase58() === creator;
  const [status, setStatus] = useState<{ enabled: boolean; connected: boolean; username: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!isCreator) return;
    fetch(`/api/agent/x?wallet=${creator}`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [isCreator, creator]);

  if (!isCreator || !status) return null;

  async function act(action: "connect" | "disconnect") {
    if (!publicKey || !signMessage) return;
    setBusy(true);
    setMsg("");
    try {
      const signed = await signRequest(action === "connect" ? "x-connect" : "x-disconnect", publicKey.toBase58(), signMessage);
      const res = await fetch("/api/agent/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signed, action, returnTo: `/token/${mint}#marketing` }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (action === "connect") window.location.href = body.url;
      else setStatus((s) => (s ? { ...s, connected: false, username: null } : s));
    } catch (e) {
      setMsg(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-brand/5 px-4 py-3 text-sm">
      <IconX_Social className="h-4 w-4" />
      {!status.enabled ? (
        <span className="text-muted">The agent posts your milestones from the FIREPAD account. Posting from your own X is available when you connect it.</span>
      ) : status.connected ? (
        <>
          <span>
            <span className="font-semibold">@{status.username}</span> <span className="text-muted">is connected. The agent posts your launch and milestones automatically.</span>
          </span>
          <button onClick={() => act("disconnect")} disabled={busy} className="ml-auto text-xs text-muted hover:text-down">
            Disconnect
          </button>
        </>
      ) : (
        <>
          <span className="text-muted">Connect your X and the agent will post your launch thread and milestones for you.</span>
          <button onClick={() => act("connect")} disabled={busy} className="btn-primary ml-auto px-3 py-1.5 text-xs">
            {busy ? "Opening X…" : "Connect X"}
          </button>
        </>
      )}
      {msg && <span className="w-full text-xs text-down">{msg}</span>}
    </div>
  );
}
