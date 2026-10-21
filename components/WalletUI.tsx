"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { explorerAddress } from "@/lib/rpc";
import { IconCheck, IconChevronDown, IconCopy, IconExternal, IconLogout, IconSwap, IconWallet, IconX } from "./Icons";

// ---------------------------------------------------------------------------
// Modal state

const Ctx = createContext<{ open: () => void; close: () => void }>({ open: () => {}, close: () => {} });
export const useConnectModal = () => useContext(Ctx);

export function ConnectModalProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const value = useMemo(() => ({ open: () => setVisible(true), close: () => setVisible(false) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {visible && <ConnectModal onClose={value.close} />}
    </Ctx.Provider>
  );
}

// Shown as install links when the wallet isn't detected in this browser.
const POPULAR = [
  { name: "Phantom", url: "https://phantom.com/download", color: "#AB9FF2" },
  { name: "Solflare", url: "https://solflare.com/download", color: "#FC7227" },
  { name: "Backpack", url: "https://backpack.app/download", color: "#E33E3F" },
];

function ConnectModal({ onClose }: { onClose: () => void }) {
  const { wallets, select, connected, connecting } = useWallet();
  const [pending, setPending] = useState<string | null>(null);

  const detected = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable
  );
  const missing = POPULAR.filter((p) => !detected.some((w) => w.adapter.name === p.name));

  // Close once the chosen wallet connects.
  useEffect(() => {
    if (pending && connected) onClose();
  }, [pending, connected, onClose]);

  // A rejected connection: `connecting` goes true → false with nothing connected.
  const sawConnecting = useRef(false);
  useEffect(() => {
    if (!pending) return;
    if (connecting) sawConnecting.current = true;
    else if (sawConnecting.current && !connected) {
      sawConnecting.current = false;
      setPending(null);
    }
  }, [pending, connecting, connected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-title"
    >
      <div className="w-full max-w-[400px] animate-pop-in rounded-t-3xl border border-line bg-panel p-5 shadow-pop sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 id="connect-title" className="text-lg font-semibold">
            Connect a wallet
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-panel2 hover:text-white">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Choose a Solana wallet to continue.</p>

        <div className="mt-4 space-y-2">
          {detected.length > 0 && <SectionLabel>Detected</SectionLabel>}
          {detected.map((w) => {
            const isPending = pending === w.adapter.name && !connected;
            return (
              <button
                key={w.adapter.name}
                disabled={!!pending}
                onClick={() => {
                  setPending(w.adapter.name);
                  select(w.adapter.name as WalletName);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-panel2/60 px-3.5 py-3 text-left transition hover:border-brand/50 hover:bg-panel2 disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" className="h-9 w-9 rounded-xl" />
                <span className="flex-1 font-medium">{w.adapter.name}</span>
                {isPending ? (
                  <span className="flex items-center gap-2 text-xs text-muted">
                    <Spinner /> Connecting
                  </span>
                ) : (
                  <span className="rounded-full bg-sol/10 px-2 py-0.5 text-[11px] font-semibold text-sol">Detected</span>
                )}
              </button>
            );
          })}

          {missing.length > 0 && <SectionLabel>{detected.length ? "More wallets" : "Get a wallet"}</SectionLabel>}
          {missing.map((p) => (
            <a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center gap-3 rounded-2xl border border-line px-3.5 py-3 transition hover:bg-panel2"
            >
              <span
                className="grid h-9 w-9 place-items-center rounded-xl text-sm font-bold text-white"
                style={{ background: p.color }}
              >
                {p.name[0]}
              </span>
              <span className="flex-1 font-medium">{p.name}</span>
              <span className="flex items-center gap-1 text-xs text-muted">
                Install <IconExternal className="h-3.5 w-3.5" />
              </span>
            </a>
          ))}
        </div>

        <p className="mt-5 text-center text-xs text-muted">
          New to Solana?{" "}
          <a href="https://solana.com/wallets" target="_blank" rel="noreferrer" className="text-white hover:underline">
            Learn about wallets
          </a>
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</div>;
}

function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted/40 border-t-white" />;
}

// ---------------------------------------------------------------------------
// Header button: "Connect" or the account menu.

export function ConnectButton({ className = "" }: { className?: string }) {
  const { open } = useConnectModal();
  const { connection } = useConnection();
  const { publicKey, wallet, connected, connecting, disconnect } = useWallet();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Wallet state only exists in the browser; render the neutral button until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() ?? "";

  const loadBalance = useCallback(async () => {
    if (!publicKey) return setBalance(null);
    const lamports = await connection.getBalance(publicKey).catch(() => null);
    setBalance(lamports === null ? null : lamports / LAMPORTS_PER_SOL);
  }, [connection, publicKey]);

  useEffect(() => {
    if (menu) loadBalance();
  }, [menu, loadBalance]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!mounted || !connected || !publicKey) {
    return (
      <button onClick={open} disabled={mounted && connecting} className={`btn-secondary h-10 ${className}`}>
        <IconWallet className="h-4 w-4" />
        {mounted && connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setMenu((m) => !m)}
        className="flex h-10 items-center gap-2 rounded-xl border border-line bg-panel2 pl-2 pr-2.5 text-sm font-semibold transition hover:bg-line"
        aria-haspopup="menu"
        aria-expanded={menu}
      >
        {wallet?.adapter.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wallet.adapter.icon} alt="" className="h-6 w-6 rounded-md" />
        ) : (
          <IconWallet className="h-5 w-5" />
        )}
        <span className="font-mono">
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
        <IconChevronDown className={`h-4 w-4 text-muted transition ${menu ? "rotate-180" : ""}`} />
      </button>

      {menu && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-40 w-64 animate-pop-in rounded-2xl border border-line bg-panel p-2 shadow-pop"
        >
          <div className="rounded-xl bg-panel2/60 p-3">
            <div className="text-xs text-muted">{wallet?.adapter.name ?? "Wallet"}</div>
            <div className="mt-0.5 font-mono text-sm">
              {address.slice(0, 6)}…{address.slice(-6)}
            </div>
            <div className="mt-2 text-lg font-semibold">
              {balance === null ? "—" : balance.toLocaleString("en-US", { maximumFractionDigits: 4 })}{" "}
              <span className="text-sm text-muted">SOL</span>
            </div>
          </div>
          <MenuItem
            onClick={async () => {
              await navigator.clipboard.writeText(address).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            icon={copied ? <IconCheck className="h-4 w-4 text-sol" /> : <IconCopy className="h-4 w-4" />}
          >
            {copied ? "Copied" : "Copy address"}
          </MenuItem>
          <MenuItem href={explorerAddress(address)} icon={<IconExternal className="h-4 w-4" />}>
            View on explorer
          </MenuItem>
          <MenuItem
            onClick={async () => {
              setMenu(false);
              await disconnect().catch(() => undefined);
              open();
            }}
            icon={<IconSwap className="h-4 w-4" />}
          >
            Change wallet
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(false);
              disconnect().catch(() => undefined);
            }}
            icon={<IconLogout className="h-4 w-4" />}
            danger
          >
            Disconnect
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
  href,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const cls = `mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition hover:bg-panel2 ${
    danger ? "text-down" : "text-white"
  }`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls} role="menuitem">
      {icon}
      {children}
    </a>
  ) : (
    <button onClick={onClick} className={cls} role="menuitem">
      {icon}
      {children}
    </button>
  );
}
