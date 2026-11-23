// Dip-buy mean-reversion bot for the BTC race (v3 fallback).
//
// Idea: cbBTC wobbles around a slow drift, so buy a dip off its recent high
// and sell the recovery. Long only, at most one open position, full cash per
// buy, fully deterministic — no clock, no randomness, no network.
//
// Entry (while flat):
//   - trailing high = highest close of the last 60 bars (current bar included)
//   - the close sits at least 1.2% below that high, and
//   - the last two closes are rising (close > prev > prev-prev), and
//   - at least 60 bars have passed since the last sell.
// Exit (while holding):
//   - the close recovers to the trailing high, or
//   - the close is 2.5% above the entry close, or
//   - the close is 1.5% below the entry close.
// Every order caps its allowed move from the latest close at 100 bps.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const ASSET = 'CBBTC';

// How far back the trailing high looks, and how many closes are kept.
const HIGH_BARS = 60;
const KEPT_BARS = 90;

// Dip: buy when close * 1000 <= high * 988 (1.2% under the high).
const DIP_NUM = 988n;
const DIP_DEN = 1000n;

// Target: sell when close * 1000 >= entry * 1025 (+2.5% over entry).
const WIN_NUM = 1025n;
const WIN_DEN = 1000n;

// Stop: sell when close * 1000 <= entry * 985 (-1.5% under entry).
const LOSE_NUM = 985n;
const LOSE_DEN = 1000n;

// Max move an order tolerates from the latest close, in basis points.
const SLIPPAGE_BPS = 100;

// Bars to rest after a sell before the next buy may fire.
const REST_BARS = 60;

class DipBuyer {
  // Recent closes, oldest first; capped at KEPT_BARS entries.
  private closes: bigint[] = [];
  // Bars actually seen (non-warm-up batches that carried a CBBTC close).
  private seen = 0;
  // Close the current position was entered at; null while flat.
  private enteredAt: bigint | null = null;
  // `seen` count of the bar the last sell was decided on.
  private lastExit = -1_000_000_000;

  private trailingHigh(): bigint {
    let top = 0n;
    for (let i = this.closes.length - HIGH_BARS; i < this.closes.length; i += 1) {
      const c = this.closes[i] as bigint;
      if (c > top) top = c;
    }
    return top;
  }

  // Uptick-2 confirm: the last two closes must both be rising, so a buy
  // fires only once the dip has started to turn instead of mid-fall.
  private confirmRising(): boolean {
    const n = this.closes.length;
    const latest = this.closes[n - 1] as bigint;
    const previous = this.closes[n - 2] as bigint;
    const beforeThat = this.closes[n - 3] as bigint;
    return latest > previous && previous > beforeThat;
  }

  // Exit check, kept separate so the three sell rules stay readable:
  // recovery to the trailing high, +2.5% target, or -1.5% stop.
  private shouldExit(close: bigint, high: bigint, entry: bigint): boolean {
    const recovered = close >= high;
    const hitTarget = close * WIN_DEN >= entry * WIN_NUM;
    const hitStop = close * LOSE_DEN <= entry * LOSE_NUM;
    return recovered || hitTarget || hitStop;
  }

  decide(state: BarsState): OrderInput[] {
    // Orders decided during warm-up are rejected, so stay quiet there.
    if (state.warmingUp) return [];
    const close = state.close(ASSET);
    // A minute with no CBBTC bar carries no signal and counts as no bar.
    if (close === null) return [];

    this.seen += 1;
    this.closes.push(close);
    if (this.closes.length > KEPT_BARS) this.closes.shift();
    // Need a full lookback before the high (or the confirm) means anything.
    if (this.closes.length < HIGH_BARS) return [];

    const high = this.trailingHigh();
    const holding = (state.positions.get(ASSET)?.qty ?? 0n) > 0n;

    if (!holding) {
      const dipped = close * DIP_DEN <= high * DIP_NUM;
      const rested = this.seen - this.lastExit >= REST_BARS;
      if (dipped && rested && this.confirmRising() && state.cash > 0n) {
        this.enteredAt = close;
        return [
          {
            side: 'buy',
            symbol: ASSET,
            notional_quote_units: state.cash,
            max_slippage_bps: SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }

    const entry = this.enteredAt ?? close;
    if (this.shouldExit(close, high, entry)) {
      const qty = (state.positions.get(ASSET) as { qty: bigint }).qty;
      this.enteredAt = null;
      this.lastExit = this.seen;
      return [
        {
          side: 'sell',
          symbol: ASSET,
          qty,
          max_slippage_bps: SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  }
}

const buyer = new DipBuyer();

await runBars({
  onBatch: (state: BarsState, _batch: Batch): OrderInput[] => buyer.decide(state),
});
