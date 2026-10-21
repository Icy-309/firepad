"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { signRequest } from "@/lib/sign-in";
import { explorerAddress } from "@/lib/rpc";
import { fmtNum, shortAddr, timeAgo } from "@/lib/format";
import { ConnectButton } from "@/components/WalletUI";


interface AdminState {
  admin: string;
  vanity: {
    suffix: string;
    available: number;
    issued: number;
    recentIssued: { pubkey: string; creator: string; issuedAt: number }[];
  };
  tokens: {
    mint: string;
    name: string;
    symbol: string;
    creator: string;
    createdAt: number;
    source: "launch" | "connect";
    hidden: boolean;
  }[];
  fireagent: {
    wallet: string;
    balanceSol: number | null;
    coins: {
      mint: string;
      symbol: string;
      holders: number | null;
      poolSol: number;
      paidSol: number;
      lastDistributeAt: number | null;
      lastPayoutAt: number | null;
      inactive?: string;
    }[];
  };
  agent: {
    claude: boolean;
    officialX: boolean;
    creatorX: boolean;
    outbox: {
      at: number;
      symbol: string;
      milestone: string;
      account: string;
      posts: string[];
      result: "posted" | "dry-run" | "error";
      ids?: string[];
      error?: string;
    }[];
  };
}

const LOW_POOL = 10;

export default function AdminPage() {
  const { publicKey, signMessage } = useWallet();
  const [state, setState] = useState<AdminState | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/state", { cache: "no-store" });
    setState(res.ok ? await res.json() : null);
    setChecked(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function login() {
    setError("");
    if (!publicKey || !signMessage) return setError("Connect a wallet that supports message signing.");
    try {
      const signed = await signRequest("admin-login", publicKey.toBase58(), signMessage);
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signed),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setState(null);
  }

  if (!checked) return <p className="text-muted">Loading…</p>;

  if (!state) {
    return (
      <div className="mx-auto max-w-md">
        <div className="card-grad rounded-2xl border border-line p-6 text-center">
          <h1 className="text-xl font-bold">Admin</h1>
          <p className="mt-2 text-sm text-muted">
            Connect an admin wallet and sign a message to sign in. Admin wallets are set with{" "}
            <code>ADMIN_WALLETS</code> on the server.
          </p>
          <div className="mt-5 flex flex-col items-center gap-3">
            <ConnectButton />
            <button
              onClick={login}
              disabled={!publicKey}
              className="w-full rounded-xl bg-gradient-to-r from-brand2 to-brand py-2.5 font-semibold disabled:opacity-40"
            >
              Sign in
            </button>
            {error && <p className="text-xs text-down">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  const launched = state.tokens.filter((t) => t.source === "launch").length;
  const hidden = state.tokens.filter((t) => t.hidden).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Admin</h1>
        <span className="rounded-full bg-panel2 px-3 py-1 font-mono text-xs text-muted">{shortAddr(state.admin)}</span>
        <button onClick={logout} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-white">
          Sign out
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`…${state.vanity.suffix} addresses left`} value={fmtNum(state.vanity.available)} warn={state.vanity.available < LOW_POOL} />
        <Stat label="Addresses issued" value={fmtNum(state.vanity.issued)} />
        <Stat label="Coins on FIREPAD" value={`${fmtNum(state.tokens.length)} (${fmtNum(launched)} launched here)`} />
        <Stat label="Hidden from feed" value={fmtNum(hidden)} />
      </div>

      <FireAgentPanel agent={state.fireagent} />
      <AgentPanel agent={state.agent} />
      <VanityPanel state={state} onChange={refresh} />
      <ModerationPanel tokens={state.tokens} onChange={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function VanityPanel({ state, onChange }: { state: AdminState; onChange: () => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const { suffix, available, recentIssued } = state.vanity;

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg("");
    try {
      const keys = await Promise.all([...files].map(async (f) => JSON.parse(await f.text())));
      const res = await fetch("/api/admin/vanity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setMsg(
        `Added ${body.added}` +
          (body.duplicates ? ` · ${body.duplicates} already in pool` : "") +
          (body.rejected.length ? ` · rejected: ${body.rejected.join("; ")}` : "")
      );
      onChange();
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={`Vanity address pool (…${suffix})`}>
      {available < LOW_POOL && (
        <p className="mb-3 rounded-lg bg-down/10 p-2 text-sm text-down">
          Only {available} addresses left — launches fail when the pool is empty. Grind more now.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm text-muted">
          <p>Refill the pool on the server, either way:</p>
          <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-xs text-white">
            {`npm run grind -- --count 100\n\n# or, much faster (Rust):\ncd data/mainnet-beta/vanity/incoming\nsolana-keygen grind --ends-with ${suffix}:100`}
          </pre>
          <p>Keys dropped in data/mainnet-beta/vanity/incoming are picked up automatically. Or upload keypair JSON files:</p>
          <input
            type="file"
            accept=".json,application/json"
            multiple
            disabled={busy}
            onChange={(e) => importFiles(e.target.files)}
            className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-panel2 file:px-3 file:py-1.5 file:text-white"
          />
          {msg && <p className="text-xs text-white">{msg}</p>}
        </div>
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted">Recently issued</div>
          {recentIssued.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {recentIssued.map((k) => (
                <li key={k.pubkey} className="flex justify-between gap-2 font-mono">
                  <span>{shortAddr(k.pubkey)}</span>
                  <span className="text-muted">to {shortAddr(k.creator)}</span>
                  <span className="text-muted">{timeAgo(k.issuedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function ModerationPanel({ tokens, onChange }: { tokens: AdminState["tokens"]; onChange: () => void }) {
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(mint: string, hidden: boolean) {
    setPending(mint);
    await fetch("/api/admin/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint, hidden }),
    });
    setPending(null);
    onChange();
  }

  const q = filter.trim().toLowerCase();
  const shown = tokens.filter(
    (t) => !q || t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.mint.toLowerCase().includes(q)
  );

  return (
    <Panel title="Moderation">
      <p className="mb-3 text-sm text-muted">
        Hiding removes a token from the public feed. It can&apos;t stop trading on pump.fun, and the agent keeps paying its holders.
      </p>
      <input
        className="mb-3 w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-brand"
        placeholder="Search name, symbol or mint"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-2 pr-3 font-normal">Token</th>
              <th className="py-2 pr-3 font-normal">Mint</th>
              <th className="py-2 pr-3 font-normal">Creator</th>
              <th className="py-2 pr-3 font-normal">Created</th>
              <th className="py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.mint} className={`border-t border-line ${t.hidden ? "opacity-50" : ""}`}>
                <td className="py-2 pr-3">
                  {t.name} <span className="text-muted">${t.symbol}</span>
                  {t.source === "connect" && <span className="ml-2 rounded bg-panel2 px-1.5 text-[10px] text-muted">connected</span>}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{shortAddr(t.mint)}</td>
                <td className="py-2 pr-3 font-mono text-xs">{shortAddr(t.creator)}</td>
                <td className="py-2 pr-3 text-xs text-muted">{timeAgo(t.createdAt)}</td>
                <td className="py-2 text-right">
                  <button
                    disabled={pending === t.mint}
                    onClick={() => toggle(t.mint, !t.hidden)}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-40 ${
                      t.hidden ? "bg-panel2 text-white" : "border border-down/50 text-down"
                    }`}
                  >
                    {t.hidden ? "Unhide" : "Hide"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="py-4 text-center text-sm text-muted">No tokens.</p>}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

/** Marketing agent: what's configured and what it posted (or would post, in dry-run). */
function AgentPanel({ agent }: { agent: AdminState["agent"] }) {
  const pill = (on: boolean, yes: string, no: string) => (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-sol/10 text-sol" : "bg-panel2 text-muted"}`}>{on ? yes : no}</span>
  );
  return (
    <Panel title="Marketing agent">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        Writer {pill(agent.claude, "Claude", "Templates (add ANTHROPIC_API_KEY)")}
        Official X {pill(agent.officialX, "Live", "Dry run (add X_API_KEY…)")}
        Creator X {pill(agent.creatorX, "Enabled", "Off (add X_CLIENT_ID)")}
      </div>
      <p className="mb-3 text-xs text-muted">
        Run <code>npm run agent</code>. It announces launches and on-chain milestones automatically, within rate limits
        and guardrails.
      </p>
      {agent.outbox.length === 0 ? (
        <p className="text-sm text-muted">Nothing posted yet.</p>
      ) : (
        <ul className="space-y-2">
          {agent.outbox.map((e, i) => (
            <li key={i} className="rounded-lg bg-panel2/50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-white">${e.symbol}</span>
                <span className="text-muted">{e.milestone}</span>
                <span className="text-muted">· {e.account}</span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 font-semibold ${
                    e.result === "posted" ? "bg-sol/10 text-sol" : e.result === "error" ? "bg-down/10 text-down" : "bg-panel2 text-muted"
                  }`}
                >
                  {e.result}
                </span>
                <span className="text-muted">{timeAgo(e.at)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-muted">{e.posts.join("\n\n")}</p>
              {e.error && <p className="mt-1 text-xs text-down">{e.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The fee agent must be running for holders to get paid. */
function FireAgentPanel({ agent }: { agent: AdminState["fireagent"] }) {
  const recent = agent.coins.some((c) => c.lastDistributeAt && Date.now() - c.lastDistributeAt < 24 * 3600_000);
  return (
    <Panel title="FIREPAD">
      <div className={`mb-3 rounded-xl border p-3 text-sm ${agent.wallet ? "border-sol/30 bg-sol/5" : "border-down/50 bg-down/10 text-down"}`}>
        {!agent.wallet ? (
          <>The FIREPAD payout wallet (NEXT_PUBLIC_FIREAGENT_WALLET) is not set, so launches and connects are off.</>
        ) : (
          <span className="text-white">
            Agent wallet <a className="font-mono underline" href={explorerAddress(agent.wallet)} target="_blank" rel="noreferrer">{shortAddr(agent.wallet)}</a>
            {agent.balanceSol !== null && <> · balance {agent.balanceSol.toFixed(4)} SOL</>}
            {" · "}
            {recent ? "distributed in the last 24h" : <>no distribution in 24h. Is <code>npm run fireagent</code> running?</>}
          </span>
        )}
      </div>
      {agent.coins.length > 0 && (
        <div className="divide-y divide-line rounded-xl border border-line text-sm">
          {agent.coins.map((c) => (
            <div key={c.mint} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <span className="w-20 font-semibold">{c.symbol || shortAddr(c.mint)}</span>
              <span className="text-muted">{c.holders === null ? "—" : fmtNum(c.holders)} holders</span>
              <span className="text-muted">pool {c.poolSol.toFixed(4)} SOL</span>
              <span className="text-muted">paid {c.paidSol.toFixed(4)} SOL</span>
              <span className="text-muted">distributed {c.lastDistributeAt ? timeAgo(c.lastDistributeAt) : "never"}</span>
              {c.inactive && <span className="w-full text-xs text-down">Split is {c.inactive}: skipped</span>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-panel p-4 ${warn ? "border-down/60" : "border-line"}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${warn ? "text-down" : ""}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel2/60 p-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
