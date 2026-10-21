"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Wordmark } from "./Logo";
import { ConnectButton } from "./WalletUI";
import { ThemeToggle } from "./ThemeToggle";
import { IconBook, IconHome, IconPlus, IconSearch, IconX_Social } from "./Icons";

const LINKS = [
  { href: "/", label: "Home", icon: IconHome },
  { href: "/create", label: "Create coin", icon: IconPlus },
  { href: "/how-it-works", label: "How it works", icon: IconBook },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

/** Desktop navigation rail. */
export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-ink/90 px-5 py-6 lg:flex">
      <Link href="/" className="px-2">
        <Wordmark />
      </Link>

      <div className="mb-3 mt-10 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted/70">
        Workspace
      </div>
      <nav className="space-y-1">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-item flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium transition ${
              isActive(path, href)
                ? "border-line bg-panel2 text-white shadow-inner"
                : "border-transparent text-muted hover:bg-panel hover:text-white"
            }`}
          >
            <Icon className={`h-[18px] w-[18px] ${isActive(path, href) ? "text-brand" : ""}`} />
            {label}
          </Link>
        ))}
      </nav>

      <Link href="/create" className="btn-primary bg-fire mt-6 w-full rounded-xl py-3.5">
        Create coin
      </Link>

      <div className="mt-auto space-y-4 text-xs text-muted">
        <div className="rounded-2xl border border-line bg-panel p-4 leading-relaxed">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">Built for holders</span>
            <span className="font-mono text-brand">50 / 50</span>
          </div>
          <p className="mt-2">Creator fees split between the creator and holders, locked by pump.fun.</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel2">
            <div className="h-full w-1/2 bg-brand" />
          </div>
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="flex items-center gap-1.5">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-up" />
            Solana mainnet
          </span>
          <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="X" className="hover:text-white">
            <IconX_Social />
          </a>
        </div>
      </div>
    </aside>
  );
}

/** Sticky top bar: search + primary actions. */
export function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur">
      <div className="flex h-[72px] items-center gap-3 px-4 lg:px-8">
        <Link href="/" className="lg:hidden">
          <Wordmark size={26} />
        </Link>
        <Suspense fallback={<div className="hidden flex-1 md:block" />}>
          <SearchBox />
        </Suspense>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <span className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-2 text-[11px] font-medium text-muted sm:inline-flex">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-up" />
            Mainnet
          </span>
          <Link href="/create" className="btn-primary hidden h-10 sm:inline-flex">
            <IconPlus className="h-4 w-4" />
            Create coin
          </Link>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  return (
    <form
      className="hidden max-w-md flex-1 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        router.push(v ? `/?q=${encodeURIComponent(v)}` : "/");
      }}
    >
      <label className="flex h-10 items-center gap-2 rounded-xl border border-line bg-panel/80 px-3 text-sm transition focus-within:border-brand">
        <IconSearch className="h-4 w-4 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, ticker or address"
          className="w-full bg-transparent outline-none placeholder:text-muted"
        />
      </label>
    </form>
  );
}

/** Bottom tab bar on phones. */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {LINKS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
            isActive(path, href) ? "text-brand" : "text-muted"
          }`}
        >
          <Icon className={`h-5 w-5 ${href === "/create" ? "text-sol" : ""}`} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
