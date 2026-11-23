// BTC race bot — dip-buy with a regime-adaptive exit.
//
// Idea: cbBTC mean-reverts after short pullbacks, but sometimes a dip is the
// start of a real trend. So the bot buys the same dip in both cases and only
// changes how it gets out, based on whether the 60-bar average is rising.
//
//   Buy  — the close fell at least 1.2% below the highest close of the last
//          60 bars, and the last two bars both closed higher than the one
//          before them (the dip is already turning). Full cash, one position
//          at a time, and at least 60 bars must have passed since the last
//          sell before the next buy.
//   Exit — decided by the trend gate measured at the moment of entry: the
//          60-bar average now versus the 60-bar average 30 bars ago.
//            * rising  -> trail the peak with a 2.0% stop, hard stop -1.5%,
//                         no profit target (let a trend run).
//            * flat/falling -> sell when the price recovers to the trailing
//                         60-bar high, or at +2.5% profit, or at -1.5% stop.
//
// Everything is integer math on raw price units, no wall clock, no random
// numbers and no network, so two runs on the same bars answer identically.
// Orders decided on one bar fill at the next bar's open.

import { runBars } from "./vendor/makefun-bars.ts";
import type { BarsState, Batch, OrderInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";

// How far back the trailing high and the entry dip look.
const HIGH_WINDOW = 60;
// How many closes to remember: enough for the trailing high and for both
// 60-bar averages the trend gate compares (60 + 30).
const HISTORY = 90;
// Bars between the two moving-average readings of the trend gate.
const GATE_LAG = 30;
// Bars that must pass after a sell before the next buy.
const COOLDOWN = 60;
// Slippage allowance on every order, in basis points.
const SLIPPAGE_BPS = 100;

// Thresholds, all as basis points of the reference price (10_000 = 100%).
const DIP_BPS = 9880; // buy once close <= high * 98.80%  (a 1.2% dip)
const PROFIT_BPS = 10250; // mean-reversion take-profit: +2.5%
const STOP_BPS = 9850; // hard stop: -1.5%
const TRAIL_BPS = 9800; // trend trailing stop: 2.0% below the peak
const TREND_PROFIT_BPS = 19900; // trend take-profit: +99% (never binds)

const BPS = 10000n;

/** The bot's memory across batches. */
class DipBot {
  /** Recent closes, oldest first, capped at HISTORY entries. */
  private closes: bigint[] = [];
  /** Non-warm-up batches answered so far. */
  private seen = 0;
  /** Value of `seen` when the last sell was decided; far past at start. */
  private lastSellSeen = -1_000_000_000;
  /** Close the open position was bought at (decision bar), if holding. */
  private entry: bigint | null = null;
  /** Highest close since the open position was bought, if holding. */
  private peak: bigint | null = null;
  /** Whether the open position was bought while the trend gate was rising. */
  private inTrend = false;

  /**
   * Mean of `window` closes ending `lagBars` bars before the latest one.
   * lagBars 0 means the window ends at the newest close; lagBars 30 ends
   * it 30 bars back. Callers must guarantee enough history is stored.
   */
  private average(window: number, lagBars: number): bigint {
    const end = this.closes.length - lagBars;
    let sum = 0n;
    for (let i = end - window; i < end; i++) sum += this.closes[i];
    return sum / BigInt(window);
  }

  /** Highest close of the last HIGH_WINDOW bars, current bar included. */
  private trailingHigh(): bigint {
    let high = 0n;
    for (let i = this.closes.length - HIGH_WINDOW; i < this.closes.length; i++) {
      if (this.closes[i] > high) high = this.closes[i];
    }
    return high;
  }

  /**
   * True when the 60-bar average is rising: its value now is above its value
   * GATE_LAG bars ago. Needs a full 90 bars of history; before that the
   * gate reads as "not a trend".
   */
  private trendRising(): boolean {
    if (this.closes.length < HISTORY) return false;
    const now = this.average(HIGH_WINDOW, 0);
    const then = this.average(HIGH_WINDOW, GATE_LAG);
    return now > then;
  }

  /** Decide the orders for one batch. Called once per bar, after warm-up. */
  decide(state: BarsState): OrderInput[] {
    const close = state.close(SYMBOL);
    if (close === null) return [];

    this.seen += 1;
    this.closes.push(close);
    if (this.closes.length > HISTORY) this.closes.shift();
    if (this.closes.length < HIGH_WINDOW) return [];

    const high = this.trailingHigh();
    const held = state.positions.get(SYMBOL);
    const holding = held !== undefined && held.qty > 0n;

    if (!holding) return this.maybeBuy(state, close, high);
    return this.maybeSell(state, close, high);
  }

  /** Buy the dip when every entry condition lines up, else nothing. */
  private maybeBuy(state: BarsState, close: bigint, high: bigint): OrderInput[] {
    // Not dipped far enough below the trailing high.
    if (close * BPS > high * BigInt(DIP_BPS)) return [];
    // Need two rising closes in a row: the dip is turning back up.
    const n = this.closes.length;
    if (!(close > this.closes[n - 2] && this.closes[n - 2] > this.closes[n - 3])) return [];
    // Still inside the cooldown after the previous sell.
    if (this.seen - this.lastSellSeen < COOLDOWN) return [];
    if (state.cash <= 0n) return [];

    this.inTrend = this.trendRising();
    this.entry = close;
    this.peak = close;
    return [
      {
        side: "buy",
        symbol: SYMBOL,
        notional_quote_units: state.cash,
        max_slippage_bps: SLIPPAGE_BPS,
      },
    ];
  }

  /** Sell the whole position when an exit condition of its regime hits. */
  private maybeSell(state: BarsState, close: bigint, high: bigint): OrderInput[] {
    const entry = this.entry ?? close;
    if (this.peak !== null && close > this.peak) this.peak = close;
    const peak = this.peak ?? close;

    const hitStop = close * BPS <= entry * BigInt(STOP_BPS);
    let exit = hitStop;
    if (this.inTrend) {
      // Riding a trend: only the trailing stop or the (never-binding)
      // profit target can take us out. A recovery to the old high is not
      // an exit here — that is the trend continuing.
      const trailedOff = close * BPS <= peak * BigInt(TRAIL_BPS);
      const hitTarget = close * BPS >= entry * BigInt(TREND_PROFIT_BPS);
      exit = exit || trailedOff || hitTarget;
    } else {
      // Mean reversion: out on recovery to the trailing high, on the
      // profit target, or on the hard stop.
      const recovered = close >= high;
      const hitTarget = close * BPS >= entry * BigInt(PROFIT_BPS);
      exit = exit || recovered || hitTarget;
    }
    if (!exit) return [];

    const qty = state.positions.get(SYMBOL)?.qty ?? 0n;
    this.entry = null;
    this.peak = null;
    this.inTrend = false;
    this.lastSellSeen = this.seen;
    return [
      {
        side: "sell",
        symbol: SYMBOL,
        qty,
        max_slippage_bps: SLIPPAGE_BPS,
      },
    ];
  }
}

const bot = new DipBot();

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    return bot.decide(state);
  },
});
