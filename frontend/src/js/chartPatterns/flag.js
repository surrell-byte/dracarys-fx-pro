import { empty } from "./common.js";

const POLE_LOOKBACK = 12; // candles used to measure the sharp move before the flag
const POLE_MIN_MOVE_PERCENT = 2.5; // minimum move to count as a real "pole", not noise
const FLAG_LOOKBACK = 12; // candles making up the consolidation itself
const FLAG_MAX_RANGE_PERCENT = 1.8; // the consolidation must stay this tight to count as a flag
const BREAKOUT_BUFFER_PERCENT = 0.15;

// A flag is a two-part shape: a sharp directional "pole" move, followed by
// a tight consolidation ("flag"), followed by a continuation breakout in
// the pole's original direction. Unlike the other chart patterns here, this
// doesn't use swing points at all — a flag's consolidation is often too
// short/tight to produce confirmed swing highs/lows within it, so this
// works directly off the high/low range of the two windows instead.
export function detectFlag(candles) {
    if (candles.length < POLE_LOOKBACK + FLAG_LOOKBACK + 2) return empty("Flag");

    // The consolidation window is the FLAG_LOOKBACK candles immediately
    // BEFORE the current one — the current candle is the breakout/confirmation
    // check, so it must not be part of the range it's being compared against.
    const flagCandles = candles.slice(-(FLAG_LOOKBACK + 1), -1);
    const poleCandles = candles.slice(-(POLE_LOOKBACK + FLAG_LOOKBACK + 1), -(FLAG_LOOKBACK + 1));
    if (poleCandles.length < POLE_LOOKBACK || flagCandles.length < FLAG_LOOKBACK) return empty("Flag");

    const poleStart = poleCandles[0].open;
    const poleEnd = poleCandles.at(-1).close;
    if (poleStart <= 0) return empty("Flag");
    const poleMovePercent = ((poleEnd - poleStart) / poleStart) * 100;
    if (Math.abs(poleMovePercent) < POLE_MIN_MOVE_PERCENT) return empty("Flag");
    const bullishPole = poleMovePercent > 0;

    const flagHigh = Math.max(...flagCandles.map(c => c.high));
    const flagLow = Math.min(...flagCandles.map(c => c.low));
    if (flagLow <= 0) return empty("Flag");
    const flagRangePercent = ((flagHigh - flagLow) / flagLow) * 100;
    if (flagRangePercent > FLAG_MAX_RANGE_PERCENT) return empty("Flag");

    const price = candles.at(-1).close;
    const tightness = Math.max(0, 1 - flagRangePercent / FLAG_MAX_RANGE_PERCENT); // 0 = barely tight enough, 1 = extremely tight
    const value = { poleMovePercent, flagHigh, flagLow };

    if (bullishPole && price > flagHigh * (1 + BREAKOUT_BUFFER_PERCENT / 100)) {
        const confidence = Math.round(Math.min(78, 45 + tightness * 20 + Math.min(Math.abs(poleMovePercent), 15)));
        return { detected: true, confidence, direction: "BUY", pattern: "Bull Flag (breakout)", reason: `Tight consolidation after a ${poleMovePercent.toFixed(1)}% move broke out upward`, value };
    }
    if (!bullishPole && price < flagLow * (1 - BREAKOUT_BUFFER_PERCENT / 100)) {
        const confidence = Math.round(Math.min(78, 45 + tightness * 20 + Math.min(Math.abs(poleMovePercent), 15)));
        return { detected: true, confidence, direction: "SELL", pattern: "Bear Flag (breakdown)", reason: `Tight consolidation after a ${poleMovePercent.toFixed(1)}% move broke down`, value };
    }

    return {
        detected: true,
        confidence: Math.round(Math.min(30, 10 + tightness * 15)),
        direction: null,
        pattern: bullishPole ? "Bull Flag (forming)" : "Bear Flag (forming)",
        reason: `Consolidating after a ${poleMovePercent.toFixed(1)}% move, no breakout yet`,
        value
    };
}

