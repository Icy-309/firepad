# Legacy: the original firepad program integration

Kept for reference after the move to pump.fun + FIREAGENT (October 2026). Nothing
here is built or imported by the app: `tsconfig.json` excludes this folder.

- `lib/program.ts`: client for the custom Anchor program in `anchor/`
- `lib/merkle.ts`, `lib/server/rewards-store.ts`, `scripts/keeper.ts`: merkle-root holder rewards
- `components/TradeWidget.tsx`, `PriceChart.tsx`, `LiveTrades.tsx`, `RewardsPanel.tsx`: trading on that program
- `scripts/e2e-*.ts`: devnet tests of that program
