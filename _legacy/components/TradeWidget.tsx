"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Token } from "@/lib/types";
import { DEV_SHARE, fmtNum, fmtSol, HOLDER_SHARE } from "@/lib/format";
import { quoteBuy, quoteSell, type CurveState } from "@/lib/curve";
import { ata2022, buyIx, decodeTokenAmount, fetchTokenStates, raydiumPool, sellIx } from "@/lib/program";
import { CLUSTER, explorerAddress, explorerTx } from "@/lib/rpc";
import { IconExternal, IconShield } from "./Icons";
import { friendlyError } from "@/lib/errors";
import { useConnectModal } from "./WalletUI";
import { WalletWaitHint } from "./WalletWaitHint";
import { useSendTx } from "@/lib/use-send-tx";

const SLIPPAGE_OPTIONS = [1, 5, 10];
const TOKEN_UNITS = 1e6; // 6 decimals
const LAMPORTS = 1e9;

type TxState = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "ok"; sig: string } | { kind: "err"; msg: string };

export function TradeWidget({ t, feeBps }: { t: Token; feeBps: number }) {
  const router = useRouter();
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const sendTx = useSendTx();
  const { open: openConnect } = useConnectModal();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.5");
  const [slippage, setSlippage] = useState(5);
  const [balance, setBalance] = useState<number | null>(null);
  const [tx, setTx] = useState<TxState>({ kind: "idle" });

  const mint = useMemo(() => new PublicKey(t.mint), [t.mint]);

  const loadBalance = useCallback(async () => {
    if (!t.live || !publicKey) return setBalance(null);
    const info = await connection.getAccountInfo(ata2022(publicKey, mint)).catch(() => null);
    setBalance(Number(decodeTokenAmount(info?.data)) / TOKEN_UNITS);
  }, [connection, publicKey, mint, t.live]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  // SOL when buying, tokens when selling.
  const qty = Math.max(0, parseFloat(amount) || 0);

  const calc = useMemo(() => {
    if (side === "buy") {
      const q = quoteBuy(t.curve, qty, feeBps);
      return {
        fee: q.feeSol,
        feeTokens: q.feeTokens,
        receive: `≈ ${fmtNum(Math.round(q.tokens))} ${t.symbol}`,
        capped: q.capped,
        spent: q.solSpent,
      };
    }
    const q = quoteSell(t.curve, qty, feeBps);
    return { fee: q.feeSol, feeTokens: q.feeTokens, receive: `≈ ${fmtSol(q.solOut, 4)} SOL`, capped: false, spent: 0 };
  }, [side, qty, t.curve, t.symbol, feeBps]);

  const overBalance = side === "sell" && balance !== null && qty > balance;

  async function trade() {
    if (!publicKey || qty <= 0) return;
    setTx({ kind: "busy", label: "Preparing…" });
    try {
      // Re-quote against the latest reserves; the page may be stale.
      const s = (await fetchTokenStates(connection, [mint])).get(t.mint);
      if (!s) throw new Error("Token state not found on-chain");
      if (s.complete) throw new Error("This token has graduated — the curve is closed");
      const curve: CurveState = {
        virtualSol: Number(s.virtualSolReserves) / LAMPORTS,
        virtualTokens: Number(s.virtualTokenReserves) / TOKEN_UNITS,
        realTokens: Number(s.realTokenReserves) / TOKEN_UNITS,
      };
      const keep = 1 - slippage / 100;
      const ix =
        side === "buy"
          ? buyIx(
              publicKey,
              mint,
              BigInt(Math.round(qty * LAMPORTS)),
              BigInt(Math.floor(quoteBuy(curve, qty, feeBps).tokens * keep * TOKEN_UNITS))
            )
          : sellIx(
              publicKey,
              mint,
              BigInt(Math.round(qty * TOKEN_UNITS)),
              BigInt(Math.floor(quoteSell(curve, qty, feeBps).solOut * keep * LAMPORTS))
            );

      const transaction = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })).add(ix);
      setTx({ kind: "busy", label: "Checking…" });
      const sig = await sendTx(transaction, {
        onApprove: () => setTx({ kind: "busy", label: "Approve in your wallet…" }),
        onSent: () => setTx({ kind: "busy", label: "Confirming…" }),
      });
      setTx({ kind: "ok", sig });
      loadBalance();
      router.refresh(); // re-render server data (price, market cap, progress)
    } catch (e) {
      setTx({ kind: "err", msg: friendlyError(e) });
    }
  }

  const busy = tx.kind === "busy";
  const disabled = !connected || qty <= 0 || busy || overBalance || t.complete || !t.live;

  return (
    t.complete ? (
      <GraduatedTrade t={t} />
    ) : (
    <div className="card p-4">
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-ink p-1">
        <button
          onClick={() => {
            setSide("buy");
            setAmount("0.5");
          }}
          className={`rounded-lg py-2 text-sm font-semibold transition ${
            side === "buy" ? "bg-up text-black" : "text-muted hover:text-white"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => {
            setSide("sell");
            setAmount(balance ? String(Math.floor(balance)) : "1000000");
          }}
          className={`rounded-lg py-2 text-sm font-semibold transition ${
            side === "sell" ? "bg-down text-white" : "text-muted hover:text-white"
          }`}
        >
          Sell
        </button>
      </div>

      <div className="flex items-baseline justify-between">
        <label className="text-xs text-muted">Amount ({side === "buy" ? "SOL" : t.symbol})</label>
        {side === "sell" && balance !== null && (
          <span className="text-[11px] text-muted">
            Balance {fmtNum(Math.floor(balance))}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center rounded-xl border border-line bg-ink px-3.5 transition focus-within:border-brand">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="w-full bg-transparent py-3 text-xl font-semibold outline-none"
          placeholder="0.0"
        />
        <span className="text-sm font-semibold text-muted">{side === "buy" ? "SOL" : t.symbol}</span>
      </div>

      <div className="mt-2 flex gap-1">
        {side === "buy"
          ? ["0.1", "0.5", "1", "5"].map((p) => (
              <Preset key={p} label={`${p} SOL`} onClick={() => setAmount(p)} />
            ))
          : balance !== null
            ? [25, 50, 100].map((pct) => (
                <Preset key={pct} label={`${pct}%`} onClick={() => setAmount(String(Math.floor((balance * pct) / 100)))} />
              ))
            : ["100000", "1000000", "10000000"].map((p) => (
                <Preset key={p} label={fmtNum(Number(p))} onClick={() => setAmount(p)} />
              ))}
      </div>

      <div className="mt-4 space-y-1.5 rounded-xl border border-line bg-ink/60 p-3 text-sm">
        <Row label="You receive" value={calc.receive} strong />
        <Row
          label={`Fee (${(feeBps / 100).toFixed(2).replace(/\.?0+$/, "")}%)`}
          value={`${fmtNum(Math.round(calc.feeTokens))} ${t.symbol} ≈ ${fmtSol(calc.fee, 4)} SOL`}
        />
        <Row label="↳ to creator (50%)" value={`${fmtSol(calc.fee * DEV_SHARE, 4)} SOL`} sub />
        <Row label="↳ to holders (50%)" value={`${fmtSol(calc.fee * HOLDER_SHARE, 4)} SOL`} sub accent />
        
        {calc.capped && (
          <p className="pt-1 text-xs text-brand">
            Fills the rest of the curve — you only pay {fmtSol(calc.spent, 4)} SOL and the token graduates.
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>Max slippage</span>
        <div className="flex gap-1">
          {SLIPPAGE_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSlippage(s)}
              className={`rounded-md px-2 py-0.5 ${slippage === s ? "bg-brand/20 text-brand" : "bg-panel2 hover:text-white"}`}
            >
              {s}%
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={connected && disabled}
        onClick={connected ? trade : openConnect}
        className={`mt-4 w-full rounded-xl py-3.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          side === "buy" ? "bg-up text-black hover:brightness-110" : "bg-down text-white hover:brightness-110"
        }`}
      >
        {!connected
          ? "Connect wallet"
          : t.complete
            ? "Graduated — curve closed"
            : busy
              ? tx.label
              : overBalance
                ? "Not enough tokens"
                : side === "buy"
                  ? `Buy ${t.symbol}`
                  : `Sell ${t.symbol}`}
      </button>

      {tx.kind === "ok" && (
        <p className="mt-2 text-center text-xs text-up">
          Transaction confirmed.{" "}
          <a href={explorerTx(tx.sig)} target="_blank" rel="noreferrer" className="underline">
            view transaction
          </a>
        </p>
      )}
      <WalletWaitHint active={tx.kind === "busy" && tx.label.startsWith("Approve")} />
      {tx.kind === "err" && <p className="mt-2 text-center text-xs text-down">{tx.msg}</p>}
      {!t.live && (
        <p className="mt-2 text-center text-[11px] text-muted">Demo token — quotes only, nothing is sent.</p>
      )}
    </div>
    )
  );
}

/** After graduation the curve is closed: trading happens in the coin's Raydium pool. */
function GraduatedTrade({ t }: { t: Token }) {
  const pool = raydiumPool(new PublicKey(t.mint)).pool.toBase58();
  const href =
    CLUSTER === "mainnet-beta"
      ? `https://raydium.io/swap/?inputMint=sol&outputMint=${t.mint}`
      : explorerAddress(pool);
  return (
    <div className="card p-4 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-sol/10 text-sol">
        <IconShield className="h-6 w-6" />
      </div>
      <h3 className="mt-3 font-semibold">{t.migrated ? "Trading on Raydium" : "Graduating to Raydium"}</h3>
      <p className="mt-1 text-sm text-muted">
        {t.migrated
          ? "This coin's curve sold out. It now trades in its Raydium pool, where the liquidity is locked forever."
          : "The curve sold out. The program is creating the Raydium pool and burning the LP. It usually takes a minute."}
      </p>
      {t.migrated && (
        <a href={href} target="_blank" rel="noreferrer" className="btn-primary mt-4 w-full py-3">
          {CLUSTER === "mainnet-beta" ? "Trade on Raydium" : "View pool"} <IconExternal className="h-4 w-4" />
        </a>
      )}
      <p className="mt-3 text-[11px] text-muted">Holders keep earning: the 1% fee applies to every trade on Raydium too.</p>
    </div>
  );
}

function Preset({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex-1 rounded-lg border border-line py-1.5 text-xs font-medium text-muted transition hover:border-muted/40 hover:text-white">
      {label}
    </button>
  );
}

function Row({
  label,
  value,
  strong,
  sub,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  sub?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`flex justify-between ${sub ? "pl-2 text-xs" : ""}`}>
      <span className="text-muted">{label}</span>
      <span className={`${strong ? "font-semibold text-white" : ""} ${accent ? "text-brand" : ""}`}>{value}</span>
    </div>
  );
}
