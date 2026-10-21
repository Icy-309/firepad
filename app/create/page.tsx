import Link from "next/link";
import { CreateCoin } from "@/components/CreateCoin";
import { ConnectCoin } from "@/components/ConnectCoin";

export default function CreatePage({ searchParams }: { searchParams: { mode?: string } }) {
  const connect = searchParams.mode === "connect";
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">{connect ? "Connect a coin" : "Create a coin"}</h1>
        <p className="mt-1 text-muted">
          {connect ? (
            "Already launched on pump.fun? Split your creator fee 50/50 with your holders, locked by pump.fun."
          ) : (
            <>
              Launch on pump.fun in one approval, buy first if you want, and let the agent handle the marketing. Your
              contract address will end in <span className="font-mono font-semibold text-sol">fire</span>.
            </>
          )}
        </p>
        <div className="mt-4 flex gap-1">
          <Link href="/create" className={`tab ${connect ? "" : "tab-active"}`}>
            New coin
          </Link>
          <Link href="/create?mode=connect" className={`tab ${connect ? "tab-active" : ""}`}>
            Existing coin
          </Link>
        </div>
      </div>
      {connect ? <ConnectCoin /> : <CreateCoin />}
    </div>
  );
}
