"use client";

import { useEffect, useState } from "react";
import { CLUSTER } from "@/lib/rpc";

/** Shown when a wallet approval has been pending for a while: usually the popup is hidden or on the wrong network. */
export function WalletWaitHint({ active, after = 15_000 }: { active: boolean; after?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(false);
    if (!active) return;
    const id = setTimeout(() => setShow(true), after);
    return () => clearTimeout(id);
  }, [active, after]);
  if (!show) return null;
  const net = CLUSTER === "mainnet-beta" ? "Mainnet" : CLUSTER === "devnet" ? "Devnet" : CLUSTER;
  return (
    <div className="mt-2 animate-fade-in rounded-xl border border-brand/30 bg-brand/5 p-3 text-left text-xs leading-relaxed text-muted">
      <div className="font-semibold text-white">Still waiting for your wallet</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>Click the wallet icon in your browser toolbar. The approval window may be open behind this one.</li>
        <li>
          Make sure the wallet is unlocked and set to <span className="font-semibold text-white">{net}</span>.
        </li>
        <li>If it still doesn&apos;t appear, reject any pending request in the wallet and try again.</li>
      </ul>
    </div>
  );
}
