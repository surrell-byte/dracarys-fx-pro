// HEURISTIC, NOT VERIFIED STOP-ORDER DATA. A "liquidity sweep" (ICT
// terminology) presumes price pushed beyond a swing high/low specifically
// to trigger resting stop orders clustered there, then reversed once those
// orders were filled. This app has no order-book data to confirm resting
// orders exist at all (same limitation liquidity.js's header documents) -
// what's actually checkable is the price-action footprint: a wick beyond
// the most recent confirmed swing point, followed by a close back on the
// original side within a few candles. That's real and falsifiable; whether
// it means stops actually got hunted is the unverified leap, so this
// carries the same "(heuristic)" tag and weight discount as liquidity.js.

import { findSwingPoints } from "@analysis/marketStructure.js";

const SWEEP_LOOKBACK = 60;
const SWEEP_TEST_CANDLES = 3; // how many of the most recent candles are checked for a wick-then-reject move
const MAX_CONFIDENCE = 55;
const WEIGHT = 0.5;

// findSwingPoints' fractal detection already requires 2 confirming candles
// on each side, so the most recent swing high/low it returns can never be
// one of the last few "live" candles - which is exactly the property this
// needs: priorHigh/priorLow are genuinely PRIOR levels, not something
// manufactured from the same candles being tested for a sweep of them.
export function detectLiquiditySweep(candles, lookback = SWEEP_LOOKBACK) {
    const recent = candles.slice(-lookback);
    if (recent.length < 20) return { swept: false, direction: null, level: null };

    const { highs, lows } = findSwingPoints(recent);
    const testWindow = recent.slice(-SWEEP_TEST_CANDLES);
    const current = recent.at(-1);
    const priorHigh = highs.at(-1);
    const priorLow = lows.at(-1);

    if (priorHigh) {
        const wicked = testWindow.some(c => c.high > priorHigh.price);
        if (wicked && current.close < priorHigh.price) {
            return { swept: true, direction: "SELL", level: priorHigh.price };
        }
    }

    if (priorLow) {
        const wicked = testWindow.some(c => c.low < priorLow.price);
        if (wicked && current.close > priorLow.price) {
            return { swept: true, direction: "BUY", level: priorLow.price };
        }
    }

    return { swept: false, direction: null, level: null };
}

export function analyzeLiquiditySweep(candles, lookback = SWEEP_LOOKBACK) {
    const result = detectLiquiditySweep(candles, lookback);
    if (!result.swept) {
        return { signal: "WAIT", confidence: 0, reason: "No liquidity sweep detected (heuristic)", value: result, weight: WEIGHT };
    }

    return {
        signal: result.direction,
        confidence: MAX_CONFIDENCE,
        reason: `Wick swept ${result.direction === "SELL" ? "above prior swing high" : "below prior swing low"} at ${result.level.toFixed(4)} then closed back inside (heuristic)`,
        value: result,
        weight: WEIGHT
    };
}
