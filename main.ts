// Dip-buy bot v4 for make.fun btc-race-24h-20261118-1444 (kanbara12).
//
// Why this is NOT v3 again. v3 (yesterday, 0603) bought all-in on a dip
// of 1.60% below the ALL-TIME high with a single-bar bounce, TP +2.00%,
// trailing arm +1.00% / trail 0.20%, SL 3%. It made +$33.55 on its dev
// window but only +$6.85 in the live race. Re-running v3's exact logic
// on THIS competition's dev window (a falling window, $65,083 -> $63,261,
// -2.8%) LOSES -$5.32 in an offline simulator: the all-time high goes
// stale within hours, so "1.60% below the high" stops meaning "a dip
// that just happened" and starts meaning "still falling". v4 changes
// the entry geometry instead of re-tuning v3's numbers:
//
//   - Rolling high: dips are measured against the highest close of the
//     last 240 bars (4 hours), not the window's all-time high. A dip is
//     only a dip relative to recent price action.
//   - Scale-in, two legs: leg 1 buys HALF the cash on a 1.40% dip that
//     is bouncing; leg 2 spends the rest only if the dip deepens to
//     1.80% while still bouncing and below the average entry (averaging
//     down into a real bottom, not catching the first falling knife).
//     If the dip is already >= 1.80% at first sight, leg 1 takes the
//     full cash.
//   - Exits: take-profit +2.00% on average entry, trailing stop armed
//     at +0.90% that sells on a 0.18% pullback from the peak since
//     entry, stop-loss 2.50% below average entry (never hit on the dev
//     window; it only guards the 25% maximum-drawdown bar on the
//     unseen race window).
//   - Long only, one open position, deterministic integer math, stdlib
//     only, no clock, no randomness, no network, no files.
//
// Offline simulator (fills at the next bar's open, 4 bps fee + 2 bps
// slippage + constant-product impact against the bar's depth, mirroring
// the kit's fill model) on this competition's 1,440-bar dev window:
//   v4: dev +$10.76 net, 5 trades, max drawdown 1.50%.
//   Neighbours are flat, not spiky: TP 1.80-2.00% x arm 0.90-1.00% all
//   land +$10.10 to +$10.76; dip1 1.20-1.40% lands +$9.03 to +$10.10.
//   Arm 0.80% is the one cliff (-$0.65) — the trailing arm is
//   load-bearing, so 0.90% keeps a full step of margin above it.
//   First half of the window +$18.45, second half -$1.08 (2 trades):
//   the edge lives in the window's early bounces; the second half the
//   bot mostly stays flat, which is the safe failure mode for a dip
//   buyer in a slow bleed. v3's exact logic on the same window: -$5.32.
//
// Honest status: +$10.76 dev passes the dev gate (needs > $0) but is
// far below yesterday's race top-10 line (+$19.90) and below v3's old
// dev number. The race window is unseen and dev does not predict race
// (yesterday: dev +$33.55 -> race +$6.85). Nothing here promises a
// top-10 race finish; this is the most robust positive-PnL config
// found on this window, chosen for stability across neighbours rather
// than the highest single number.

import { BPS, runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const DIP1_BPS = 140n; // leg 1: buy half the cash at 1.40% below the 4h rolling high
const DIP2_BPS = 180n; // leg 2: spend the rest at 1.80% below the rolling high
const TAKE_PROFIT_BPS = 200n; // sell everything at +2.00% unrealised gain
const ARM_BPS = 90n; // trailing stop arms once the gain reaches +0.90%
const TRAIL_EXIT_BPS = 18n; // ...then sell on a 0.18% pullback from the peak
const STOP_BPS = 250n; // stop-loss: 2.50% below average entry
const ROLL_BARS = 240; // rolling-high lookback (4 hours)
const MAX_SLIPPAGE_BPS = 200; // 2% slippage allowance on every order

/** Closes seen so far, in batch order. */
const closes: bigint[] = [];
/** Highest close since the current position was opened (0n when flat). */
let peak = 0n;

/** Highest close of the last ROLL_BARS bars (including the current one). */
function rollingHigh(): bigint {
  let high = 0n;
  const window = closes.slice(-ROLL_BARS);
  for (const c of window) {
    if (c > high) high = c;
  }
  return high;
}

/** Dip of `close` below `high`, in basis points (integer, truncated). */
function dipBps(close: bigint, high: bigint): bigint {
  if (high === 0n || close >= high) return 0n;
  return ((high - close) * BPS) / high;
}

/** True when the current close is up on the previous bar's close. */
function bounced(): boolean {
  if (closes.length < 2) return false;
  return closes[closes.length - 1] > closes[closes.length - 2];
}

/** Average entry price of the open position, or null when flat. */
function avgEntry(state: BarsState): bigint | null {
  const pos = state.positions.get(SYMBOL);
  if (pos === undefined || pos.qty === 0n) return null;
  // cost (quote units) = qty * price * 10^quote_scale / 10^(qty_scale + price_scale)
  //   => price = cost * 10^(8 + 5) / (qty * 10^6) = cost * 10^7 / qty.
  return (pos.cost * 10_000_000n) / pos.qty;
}

/** Unrealised gain of the open position, in basis points, or null when flat. */
function gainBps(state: BarsState): bigint | null {
  const pos = state.positions.get(SYMBOL);
  if (pos === undefined || pos.qty === 0n || pos.cost === 0n) return null;
  const value = state.value(SYMBOL, pos.qty);
  if (value <= pos.cost) return 0n;
  return ((value - pos.cost) * BPS) / pos.cost;
}

await runBars({
  onBatch(state, batch) {
    const close = state.close(SYMBOL);
    if (close === null) return [];
    closes.push(close);
    if (state.warmingUp) return [];

    const high = rollingHigh();
    const dip = dipBps(close, high);
    const orders: OrderInput[] = [];

    const pos = state.positions.get(SYMBOL);
    const holding = pos !== undefined && pos.qty > 0n;

    if (!holding) {
      // ---- flat: scale in on a deep dip that is bouncing ----
      if (dip >= DIP1_BPS && bounced()) {
        const room = state.weightRoom(SYMBOL);
        // Already deep: take the full cash; otherwise leg 1 is half.
        let spend = dip >= DIP2_BPS ? state.cash : state.cash / 2n;
        if (spend > room) spend = room;
        const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
        if (spend >= minNotional && spend > 0n) {
          orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
          peak = close;
        }
      }
      return orders;
    }

    // ---- holding: track the peak since entry ----
    if (peak === 0n) peak = close;
    if (close > peak) peak = close;

    const entry = avgEntry(state);
    const gain = gainBps(state);

    // ---- leg 2: dip deepened below the average entry, still bouncing ----
    if (entry !== null && close < entry && dip >= DIP2_BPS && bounced()) {
      const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
      if (state.cash >= minNotional && state.cash > 0n) {
        const room = state.weightRoom(SYMBOL);
        const spend = state.cash < room ? state.cash : room;
        if (spend >= minNotional) {
          orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
          return orders;
        }
      }
    }

    // ---- holding: exit rules ----
    let sell = false;
    if (entry !== null && close * BPS <= entry * (BPS - STOP_BPS)) {
      sell = true; // stop-loss: 2.50% below average entry
    } else if (gain !== null && gain >= TAKE_PROFIT_BPS) {
      sell = true; // take-profit: +2.00% unrealised gain
    } else if (
      gain !== null &&
      gain >= ARM_BPS &&
      peak > 0n &&
      close * BPS <= peak * (BPS - TRAIL_EXIT_BPS)
    ) {
      sell = true; // trailing stop: up 0.90%, now 0.18% off the peak
    }
    if (sell) {
      orders.push({ side: 'sell', symbol: SYMBOL, qty: pos!.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      peak = 0n;
    }
    return orders;
  },
});
