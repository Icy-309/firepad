import Link from "next/link";
import { IconBolt, IconGift, IconShield, IconTrend, IconUsers, IconX_Social } from "@/components/Icons";

export const metadata = { title: "How it works — FIREPAD" };

const STEPS = [
  {
    icon: IconBolt,
    title: "Launch or connect",
    body: "Launch a pump.fun coin with a CA that ends in fire, or connect a pump.fun coin you already made.",
  },
  {
    icon: IconUsers,
    title: "Buy first",
    body: "When you launch here, you can buy in the same transaction that creates the coin, so nobody can buy before you.",
  },
  {
    icon: IconTrend,
    title: "Trade on pump.fun",
    body: "Your coin trades on pump.fun like any other, on its bonding curve and then on PumpSwap after it graduates.",
  },
  {
    icon: IconGift,
    title: "Split the creator fee",
    body: "Every trade pays pump.fun's creator fee. It's split 50/50: half to the creator, half to holders.",
  },
  {
    icon: IconShield,
    title: "Holders get paid",
    body: "Holders get their half in SOL, by how much they hold, sent straight to their wallets. Nothing to claim.",
  },
  {
    icon: IconX_Social,
    title: "Get promoted",
    body: "The agent writes your launch thread, captions and a TikTok-ready video, and posts your milestones on X automatically.",
  },
];

const FAQ = [
  {
    q: "How do holder payouts work?",
    a: "Half of each coin's creator fee is set aside for its holders. Once enough has built up, it's sent straight to their wallets in SOL, by how much they hold. Every payout is listed on the coin's page.",
  },
  {
    q: "Who counts as a holder?",
    a: "Wallets that hold at least 0.1% of the coin's supply. Smaller wallets aren't paid, so the holders' half isn't spread into tiny amounts. The creator isn't included, since pump.fun already pays them their half, and neither are the bonding curve or liquidity pools.",
  },
  {
    q: "Can the 50/50 split be changed?",
    a: "No. The split uses pump.fun's own fee sharing, and pump.fun locks it once it's set. Nobody can change it afterwards.",
  },
  {
    q: "Does FIREPAD ever hold the creator's money?",
    a: "No. pump.fun pays the creator's half straight to the creator. Only the holders' half passes through the FIREPAD payout wallet on its way to holders.",
  },
  {
    q: "I already launched on pump.fun. Can I join?",
    a: "Yes. Use Connect a coin with the wallet that created it. It's one transaction that sets the 50/50 split. It only works if your creator fee isn't already shared some other way.",
  },
  {
    q: "What does the marketing agent do?",
    a: "Every coin gets a Launch Kit: lore, an X launch thread, captions and a 15-second vertical video for TikTok, Reels and Shorts. The agent also posts launches and real on-chain milestones on X. It never makes price predictions or promises.",
  },
  {
    q: "Why do addresses end in fire?",
    a: "Every coin launched here gets a contract address that ends in fire, so you can tell at a glance where it came from. Connected coins keep their original address.",
  },
  {
    q: "What does it cost?",
    a: "FIREPAD doesn't charge a platform fee. Launching costs about 0.02 SOL in Solana network costs, plus whatever you choose to buy. Trading fees are pump.fun's own.",
  },
  {
    q: "Is this safe?",
    a: "Memecoins are very risky and most go to zero. Only trade what you can afford to lose.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <section className="reveal relative pt-4 text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight">How FIREPAD works</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted">
          pump.fun coins that pay the people who hold them. Each coin&apos;s creator fee is split 50/50 between its
          creator and its holders, pump.fun locks the split, and an AI agent handles the marketing.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <div key={title} className="reveal card hover-lift p-5" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-sol/10 text-sol">
                <Icon className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-muted">Step {i + 1}</span>
            </div>
            <h2 className="mt-3 text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>

      <section id="fees" className="card scroll-mt-24 p-6">
        <h2 className="text-xl font-semibold">Where the creator fee goes</h2>
        <p className="mt-1 text-sm text-muted">On every trade, on the bonding curve and after graduation.</p>
        <div className="mt-5 overflow-hidden rounded-xl border border-line">
          <div className="flex h-10 text-sm font-semibold">
            <div className="flex w-1/2 items-center justify-center bg-brand text-white">Creator 50%</div>
            <div className="flex w-1/2 items-center justify-center bg-sol text-black">Holders 50%</div>
          </div>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">FIREPAD fee</dt>
            <dd className="mt-0.5 text-lg font-semibold">None</dd>
          </div>
          <div>
            <dt className="text-muted">Split</dt>
            <dd className="mt-0.5 text-lg font-semibold">Locked by pump.fun</dd>
          </div>
          <div>
            <dt className="text-muted">Creator&apos;s half</dt>
            <dd className="mt-0.5 text-lg font-semibold">Paid by pump.fun</dd>
          </div>
          <div>
            <dt className="text-muted">Holders&apos; half</dt>
            <dd className="mt-0.5 text-lg font-semibold">Paid by the agent</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          The creator fee rate itself is set by pump.fun.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-xl font-semibold">Marketing on autopilot</h2>
        <ul className="mt-4 grid gap-3 text-sm text-muted sm:grid-cols-2">
          <li><span className="font-semibold text-white">Launch Kit:</span> lore, an X thread and captions, written for your coin.</li>
          <li><span className="font-semibold text-white">Video:</span> a 15-second vertical clip of your coin and its market cap, ready for TikTok, Reels and Shorts.</li>
          <li><span className="font-semibold text-white">X posts:</span> launch and milestone posts from FIREPAD and from your own X if you connect it.</li>
          <li><span className="font-semibold text-white">Honest:</span> only real on-chain facts, never price predictions.</li>
        </ul>
      </section>

      <section id="faq" className="scroll-mt-24">
        <h2 className="text-xl font-semibold">FAQ</h2>
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {q}
                <span className="ml-4 text-muted transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="card flex flex-col items-center p-8 text-center">
        <h2 className="font-display text-2xl font-bold">Ready to launch?</h2>
        <p className="mt-1 text-muted">It takes less than a minute.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/create" className="btn-primary px-6 py-3">
            Create a coin
          </Link>
          <Link href="/create?mode=connect" className="btn-secondary px-6 py-3">
            Connect a coin
          </Link>
        </div>
      </section>
    </div>
  );
}
