import { NextResponse } from "next/server";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { adminRoute } from "@/lib/server/admin-route";
import { getHidden, vanityStats } from "@/lib/server/store";
import { listCoins } from "@/lib/server/fireagent-store";
import { agentKey } from "@/lib/server/agent-key";
import { assertMainnetConnection, connection } from "@/lib/server/connection";
import { loadOutbox } from "@/lib/server/agent/posts";
import { claudeEnabled } from "@/lib/server/agent/claude";
import { creatorOAuthEnabled, officialEnabled } from "@/lib/server/agent/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (admin) => {
  await assertMainnetConnection();
  const agentWallet = agentKey();
  const [vanity, coins, hidden, outbox, balance] = await Promise.all([
    vanityStats(),
    listCoins(),
    getHidden(),
    loadOutbox(),
    agentWallet ? connection.getBalance(agentWallet).catch(() => null) : Promise.resolve(null),
  ]);
  const agent = { claude: claudeEnabled(), officialX: officialEnabled(), creatorX: creatorOAuthEnabled(), outbox: outbox.slice(0, 25) };
  const tokens = coins.map((c) => ({
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    creator: c.creator,
    createdAt: c.connectedAt,
    source: c.source,
    hidden: hidden.has(c.mint),
  }));
  const fireagent = {
    wallet: agentWallet?.toBase58() ?? "",
    balanceSol: balance === null ? null : balance / LAMPORTS_PER_SOL,
    coins: coins.map((c) => ({
      mint: c.mint,
      symbol: c.symbol,
      holders: c.holders,
      poolSol: c.holderPoolLamports / LAMPORTS_PER_SOL,
      paidSol: c.holderPaidLamports / LAMPORTS_PER_SOL,
      lastDistributeAt: c.lastDistributeAt,
      lastPayoutAt: c.lastPayoutAt,
      inactive: c.inactive,
    })),
  };
  return NextResponse.json({ admin, vanity, tokens, fireagent, agent });
});
