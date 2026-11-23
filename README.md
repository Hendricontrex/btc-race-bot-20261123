[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Hendricontrex/btc-race-bot-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Hendricontrex/btc-race-bot-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

# BTC race bot — regime-adaptive dip buyer (trl1.8)

A bot for the make.fun round `btc-race-24h-20261123-0511`: it trades Coinbase
Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars, starting from
1,000 USDC of paper money.

## Strategy

- **Entry:** buy with all cash when the close dips at least 1.2% under the
  trailing 60-bar high **and** the last two closes confirm the turn
  (close > previous close > the one before). One position at a time, and 60
  bars of rest after every sale.
- **Exit, regime-dependent:** at entry the bot checks whether SMA(60) has been
  rising over the last 30 bars (slope only, not the price level).
  - **Uptrend:** ride the move with a 1.8% trailing stop from the peak since
    entry, plus a 1.5% hard stop. No profit target, no sale on recovery.
  - **No uptrend:** mean reversion — sell on recovery to the trailing high,
    on a +2.5% target, or on a −1.5% stop.
- **Costs:** every order carries `max_slippage_bps: 100`. All decisions use
  integer (bigint) arithmetic on the bars only — no clock, no randomness, no
  network — so the two graded runs agree byte for byte.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript).
- `vendor/makefun-bars.ts` — the kit's `agent-fun/bars-replay/v1` shim, copied
  byte-identical.

## Grade locally

From the competition kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo> --driver process
```

Expected on the published dev window: net PnL ≈ +$5.07, 1 trade,
max drawdown ≈ 1.58% (passes the dev gate, which needs net PnL above $0).
