# BTC Race Bot — Dip-Buy Mean Reversion (v3 fallback)

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Hendricontrex/btc-race-bot-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Hendricontrex/btc-race-bot-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A bot for the make.fun competition
[btc-race-24h-20261123-0511](https://make.fun/bounty/btc-race-24h-20261123-0511):
it trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain
bars, starting from 1,000 USDC of paper money. Long only, at most one open
position, fully deterministic.

## Strategy

Mean reversion on dips, no trend filter:

- **Trailing high** = the highest close of the last 60 bars.
- **Buy** (full cash) when the close is at least **1.2% below** that high,
  the last two closes are rising (`close > prev > prev-prev`), and at least
  60 bars have passed since the last sell.
- **Sell** everything when the close recovers to the trailing high, or
  reaches **+2.5%** over the entry close, or falls **−1.5%** under it.
- Every order sets `max_slippage_bps: 100`.
- No trading during warm-up; a minute with no cbBTC bar is skipped.

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only).
- `vendor/makefun-bars.ts` — the kit's `agent-fun/bars-replay/v1` shim,
  copied byte-identical from the competition kit.

## Grade it locally

```sh
node <kit>/cli/makefun.mjs grade-local \
  --kit <kit> \
  --bot . \
  --driver process
```

Dev-window grade: net PnL ≈ **+$0.13**, **2 trades**, max drawdown ≈ **0.39%**
— above $0, so the entry passes the dev gate and races.
