"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Position, Token } from "@/lib/types";
import { fmtNum, fmtSol } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { explorerTx } from "@/lib/rpc";
import { useSendTx } from "@/lib/use-send-tx";
import {
  ata2022,
  claimCreatorFeesIx,
  claimRewardsIx,
  claimStatusPda,
  decodeClaimed,
  decodeTokenAmount,
  decodeTokenState,
  tokenStatePda,
} from "@/lib/program";

const hexBytes = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

export function RewardsPanel({ t, position }: { t: Token; position?: Position }) {
  if (t.live || !position) return <LiveRewardsPanel t={t} />;
  return <DemoRewardsPanel t={t} position={position} />;
}

// ---------------------------------------------------------------------------

interface LiveState {
  balance: bigint;
  /** Cumulative allocation in the latest on-chain root, and its proof. */
  cumulative: bigint;
  proof: Uint8Array[];
  claimable: bigint;
  creatorOwed: bigint;
  isCreator: boolean;
}

function LiveRewardsPanel({ t }: { t: Token }) {
  const router = useRouter();
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const sendTx = useSendTx();
  const [state, setState] = useState<LiveState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const mint = useMemo(() => new PublicKey(t.mint), [t.mint]);

  const load = useCallback(async () => {
    if (!publicKey) return setState(null);
    const [[tsInfo, ataInfo, claimInfo], res] = await Promise.all([
      connection.getMultipleAccountsInfo([tokenStatePda(mint), ata2022(publicKey, mint), claimStatusPda(mint, publicKey)]),
      fetch(`/api/rewards/${t.mint}?wallet=${publicKey.toBase58()}`, { cache: "no-store" }),
    ]);
    const ts = tsInfo ? decodeTokenState(tsInfo.data) : null;
    if (!ts) return setState(null);
    const api = res.ok ? ((await res.json()) as { root: string | null; cumulative: string; proof: string[] }) : null;
    // Only trust a proof built against the root that's actually on-chain right now.
    const onchainRoot = Array.from(ts.rewardsRoot, (b) => b.toString(16).padStart(2, "0")).join("");
    const fresh = !!api && api.root === onchainRoot;
    const cumulative = fresh ? BigInt(api!.cumulative) : 0n;
    const claimed = decodeClaimed(claimInfo?.data);
    setState({
      balance: decodeTokenAmount(ataInfo?.data),
      cumulative,
      proof: fresh ? api!.proof.map(hexBytes) : [],
      claimable: cumulative > claimed ? cumulative - claimed : 0n,
      creatorOwed: ts.creatorFeesOwed,
      isCreator: ts.creator.equals(publicKey),
    });
  }, [connection, publicKey, mint, t.mint]);

  useEffect(() => {
    load().catch(() => setState(null));
    const id = setInterval(() => load().catch(() => undefined), 15_000);
    return () => clearInterval(id);
  }, [load]);

  async function send(label: string, ix: TransactionInstruction) {
    if (!publicKey) return;
    setBusy(label);
    setMsg(null);
    try {
      const sig = await sendTx(new Transaction().add(ix));
      setMsg({ ok: true, text: `${label}.`, sig });
      await load();
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!connected || !publicKey) {
    return (
      <div className="card p-4">
        <h3 className="text-sm font-semibold">Your rewards</h3>
        <p className="mt-2 text-sm text-muted">
          Connect a wallet to see your balance and the fees you can claim.
        </p>
      </div>
    );
  }

  const tokens = state ? Number(state.balance) / 1e6 : 0;
  const claimableSol = state ? Number(state.claimable) / 1e9 : 0;
  const creatorSol = state ? Number(state.creatorOwed) / 1e9 : 0;
  const status = !state ? "…" : tokens > 0 ? "Earning" : state.cumulative > 0n ? "Past holder" : "No tokens";

  return (
    <div className="space-y-4">
      <div className="card relative overflow-hidden p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Your rewards</h3>
          <span className="rounded-full bg-sol/10 px-2 py-0.5 text-[11px] font-semibold text-sol">50% of every fee</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Box label="Balance" value={`${fmtNum(Math.floor(tokens))} ${t.symbol}`} />
          <Box label="Value" value={`${fmtSol(tokens * t.priceSol, 3)} SOL`} />
          <Box label="Claimable now" value={`${fmtSol(claimableSol, 6)} SOL`} accent />
          <Box label="Status" value={status} />
        </div>

        <button
          disabled={!!busy || !state || state.claimable === 0n}
          onClick={() => state && send("Claimed", claimRewardsIx(publicKey, mint, state.cumulative, state.proof))}
          className="btn-primary mt-4 w-full py-3"
        >
          {busy === "Claimed" ? "Claiming…" : `Claim ${fmtSol(claimableSol, 6)} SOL`}
        </button>

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Half of every trade fee is shared by holders in proportion to their balance over time. Rewards are counted on
          your main (associated) token account and become claimable each time a new rewards epoch is posted.
        </p>
      </div>

      {state?.isCreator && (
        <div className="card border-sol/30 p-4">
          <h3 className="text-sm font-semibold">Creator fees</h3>
          <p className="mt-1 text-xs text-muted">You launched this token — 50% of every trade fee is yours.</p>
          <div className="mt-3">
            <Box label="Unclaimed" value={`${fmtSol(creatorSol, 6)} SOL`} />
          </div>
          <button
            disabled={!!busy || state.creatorOwed === 0n}
            onClick={() => send("Creator fees claimed", claimCreatorFeesIx(publicKey, mint))}
            className="btn-primary mt-3 w-full py-3"
          >
            {busy === "Creator fees claimed" ? "Claiming…" : `Claim ${fmtSol(creatorSol, 6)} SOL`}
          </button>
        </div>
      )}

      {msg && (
        <p className={`text-center text-xs ${msg.ok ? "text-up" : "text-down"}`}>
          {msg.text}{" "}
          {msg.sig && (
            <a href={explorerTx(msg.sig)} target="_blank" rel="noreferrer" className="underline">
              view transaction
            </a>
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DemoRewardsPanel({ t, position }: { t: Token; position: Position }) {
  const { connected } = useWallet();
  const [claimed, setClaimed] = useState(false);

  if (!connected) {
    return (
      <div className="card p-4">
        <h3 className="text-sm font-semibold">Your rewards</h3>
        <p className="mt-2 text-sm text-muted">
          Connect a wallet to see your balance and the fees you can claim.
        </p>
      </div>
    );
  }

  return (
    <div className="card relative overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Your rewards</h3>
        <span className="rounded-full bg-sol/10 px-2 py-0.5 text-[11px] font-semibold text-sol">demo data</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Box label="Balance" value={`${fmtNum(position.balance)} ${t.symbol}`} />
        <Box label="Value" value={`${fmtSol(position.valueSol, 3)} SOL`} />
        <Box label="Lifetime earned" value={`${fmtSol(position.lifetimeEarnedSol, 3)} SOL`} />
        <Box label="Claimable now" value={`${claimed ? "0.000" : fmtSol(position.claimableSol, 3)} SOL`} accent />
      </div>

      <button
        disabled={claimed || position.claimableSol <= 0}
        onClick={() => setClaimed(true)}
        className="btn-primary mt-4 w-full py-3"
      >
        {claimed ? "Claimed (demo)" : `Claim ${fmtSol(position.claimableSol, 3)} SOL`}
      </button>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Your share of the 50% holder fee builds up as others trade, in proportion to your balance. Nothing to stake
        or lock.
      </p>
    </div>
  );
}

function Box({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-ink/60 p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 font-semibold ${accent ? "text-sol" : "text-white"}`}>{value}</div>
    </div>
  );
}
