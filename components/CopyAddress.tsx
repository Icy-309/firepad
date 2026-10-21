"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "./Icons";

/** Contract address with the "fire" suffix highlighted and a copy button. */
export function CopyAddress({
  address,
  full = false,
  label = "CA",
  className = "",
}: {
  address: string;
  full?: boolean;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const fire = address.endsWith("fire");
  const head = fire ? address.slice(0, -4) : address;
  const shown = full ? head : `${head.slice(0, 4)}…${head.slice(-4)}`;

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy contract address"
      className={`group inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-ink/60 px-2 py-1 font-mono text-xs text-muted transition hover:border-brand/50 hover:text-white ${className}`}
    >
      {label && <span className="font-sans font-semibold text-muted/80">{label}</span>}
      <span className="min-w-0 truncate">
        {shown}
        {fire && <span className="font-semibold text-sol">fire</span>}
      </span>
      {copied ? <IconCheck className="h-3.5 w-3.5 shrink-0 text-sol" /> : <IconCopy className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
