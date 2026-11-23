// Regime-adaptive dip buyer for the make.fun BTC race, round btc-race-24h-20261123-0511.
//
// The idea, in one paragraph: BTC spends most minutes drifting sideways, then
// snaps back after a short dip. This bot waits for a dip of at least 1.2% under
// the trailing 60-bar high, confirms the turn with two rising closes, and buys
// with all its cash. How it gets out depends on the regime at entry: when the
// 60-bar average has been climbing for the last 30 bars the dip is treated as a
// pullback inside an uptrend, so the bot rides it with a 1.8% trailing stop and
// no profit target; when the average is flat or falling the dip is treated as a
// mean-reversion setup, so the bot sells on recovery to the trailing high, on a
// 2.5% gain, or on a 1.5% loss. One position at a time, 60 bars of rest after
// every sale, and nothing but the bars themselves decides anything.
//
// All arithmetic is integer (bigint) so the two graded runs agree byte for
// byte: no clock, no randomness, no network, no files.

import { runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Knobs, all in bars or basis points (1 bp = 0.01%).
const WINDOW = 60; // trailing-high window and SMA length, in bars
const DIP_BPS = 120; // buy when close is this far under the trailing high
const REST_BARS = 60; // bars to wait after a sale before the next buy
const SLOPE_BARS = 30; // SMA(60) now vs SMA(60) this many bars ago
const REVERT_TARGET_BPS = 250; // mean-reversion exit: +2.5% from entry
const STOP_BPS = 150; // exit on a 1.5% loss from entry, either regime
const TRAIL_BPS = 180; // trend exit: 1.8% trailing stop from the peak
const SLIPPAGE_BPS = 100; // max_slippage_bps on every order

const BPS_DENOM = 10_000n;

// price * (1 - bps / 10000), truncated toward zero.
function belowBy(price: bigint, bps: number): bigint {
  return (price * (BPS_DENOM - BigInt(bps))) / BPS_DENOM;
}

// price * (1 + bps / 10000), truncated toward zero.
function aboveBy(price: bigint, bps: number): bigint {
  return (price * (BPS_DENOM + BigInt(bps))) / BPS_DENOM;
}

// Largest close among the last `n` entries of `closes` (all of them when fewer).
function trailingHigh(closes: bigint[], n: number): bigint {
  let high = 0n;
  const start = Math.max(0, closes.length - n);
  for (let i = start; i < closes.length; i++) {
    if (closes[i]! > high) high = closes[i]!;
  }
  return high;
}

// Sum of the last `n` closes, or null when fewer than `n` are known.
function trailingSum(closes: bigint[], n: number): bigint | null {
  if (closes.length < n) return null;
  let sum = 0n;
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i]!;
  return sum;
}

// Is the 60-bar average rising? Compares the sum of the last 60 closes with
// the sum of the 60 closes ending 30 bars ago (same length, so the sums
// compare directly and no division is needed). Needs 90 closes to answer.
function trendIsUp(closes: bigint[]): boolean {
  const now = trailingSum(closes, WINDOW);
  if (now === null || closes.length < WINDOW + SLOPE_BARS) return false;
  let then = 0n;
  for (let i = closes.length - WINDOW - SLOPE_BARS; i < closes.length - SLOPE_BARS; i++) {
    then += closes[i]!;
  }
  return now > then;
}

// One open trade, remembered from the bar its buy was decided on.
interface OpenTrade {
  trendRide: boolean; // true: trend exit rules; false: mean-reversion exit rules
  entryClose: bigint; // close on the bar the buy was decided
  peakClose: bigint; // highest close seen since the entry
}

const closes: bigint[] = [];
let openTrade: OpenTrade | null = null;
let awaitingBuy: { trendRide: boolean; entryClose: bigint; clientId: string } | null = null;
let lastSaleSeq = -10_000;

await runBars({
  onBatch(state, batch) {
    // A buy we sent last bar: if the harness refused it, drop the pending
    // entry so a later dip can try again instead of waiting forever.
    if (awaitingBuy !== null) {
      for (const fill of batch.fills) {
        if (fill.client_id === awaitingBuy.clientId && fill.status === 'rejected') {
          awaitingBuy = null;
        }
      }
    }

    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar !== undefined) closes.push(BigInt(bar.c));
    const close = closes.length > 0 ? closes[closes.length - 1]! : null;

    const held = state.positions.get(SYMBOL);
    const holding = held !== undefined && held.qty > 0n;

    // The position showed up after our buy filled: anchor the trade on it.
    if (holding && openTrade === null && close !== null) {
      const anchored = awaitingBuy ?? { trendRide: trendIsUp(closes), entryClose: close };
      openTrade = {
        trendRide: anchored.trendRide,
        entryClose: anchored.entryClose,
        peakClose: anchored.entryClose > close ? anchored.entryClose : close,
      };
      awaitingBuy = null;
    }

    if (state.warmingUp || close === null) return [];

    // --- Holding: decide whether to sell. ---
    if (holding && openTrade !== null) {
      if (close > openTrade.peakClose) openTrade.peakClose = close;
      const high = trailingHigh(closes, WINDOW);
      let sell = false;
      if (openTrade.trendRide) {
        // Ride the uptrend: out on the trailing stop or the hard stop only.
        sell = close <= belowBy(openTrade.peakClose, TRAIL_BPS) || close <= belowBy(openTrade.entryClose, STOP_BPS);
      } else {
        // Mean reversion: out on recovery to the high, the target, or the stop.
        sell =
          close >= high || close >= aboveBy(openTrade.entryClose, REVERT_TARGET_BPS) || close <= belowBy(openTrade.entryClose, STOP_BPS);
      }
      if (sell) {
        const qty = state.positions.get(SYMBOL)!.qty;
        lastSaleSeq = state.seq;
        openTrade = null;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIPPAGE_BPS }];
      }
      return [];
    }

    // --- Flat: decide whether to buy. ---
    if (holding || awaitingBuy !== null) return [];
    if (closes.length < WINDOW) return [];
    if (state.seq - lastSaleSeq < REST_BARS) return [];
    if (state.cash <= 0n) return [];

    const high = trailingHigh(closes, WINDOW);
    const prev = closes[closes.length - 2]!;
    const prevPrev = closes[closes.length - 3]!;
    // Two rising closes confirm the turn; the dip itself is the trigger.
    const turningUp = close > prev && prev > prevPrev;
    const dipped = close <= belowBy(high, DIP_BPS);
    if (!turningUp || !dipped) return [];

    const trendRide = trendIsUp(closes);
    const clientId = state.clientId();
    awaitingBuy = { trendRide, entryClose: close, clientId };
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: SLIPPAGE_BPS, client_id: clientId }];
  },
});
