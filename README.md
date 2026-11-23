# BTC Race Bot — dip-buy, regime-adaptive exit

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Hendricontrex/btc-race-bot-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Hendricontrex/btc-race-bot-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Bot for [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261123-0511): trades cbBTC (CBBTC) against USDC on 1-minute on-chain bars, starting with $1,000 of paper money, long only, one position at a time.

## Strategy

Dip-buy with a regime-adaptive exit:

- **Buy** — the close fell at least 1.2% below the highest close of the last 60 bars, and the last two bars both closed higher than the one before them (the dip is already turning). Full cash, and at least 60 bars must have passed since the last sell.
- **Exit** — depends on the trend gate measured at entry: the 60-bar average now versus the 60-bar average 30 bars ago.
  - *Rising* → trail the peak with a 2.0% stop, hard stop −1.5%, no profit target (let a trend run). A recovery to the old high is not an exit.
  - *Flat/falling* → sell on recovery to the trailing 60-bar high, or at +2.5% profit, or at −1.5% stop.
- Every order carries `max_slippage_bps: 100`. No wall clock, no randomness, no network — two runs on the same bars answer identically.

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, runs as `node main.ts`).
- `vendor/makefun-bars.ts` — the kit's bars-replay shim, copied byte-identical.

## Grade locally

```sh
node ~/workspace/makefun/btc-race/btc-race-24h-20261123-0511-kit/cli/makefun.mjs grade-local \
  --kit ~/workspace/makefun/btc-race/btc-race-24h-20261123-0511-kit \
  --bot ~/workspace/makefun/btc-race/build-trl2 \
  --driver process
```

Dev-window expectation: net PnL ≈ +$5.07, 1 trade, max drawdown ≈ 1.58% (passes the dev gate: net PnL above $0).
