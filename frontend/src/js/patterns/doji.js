import { calculateEMA } from "../indicators/indicators.js";

// A doji signals indecision on its own — the reversal-warning read only
// applies when it shows up after an existing trend. Confidence stays modest
// even then, since a doji is a caution flag, not a trigger.
export function analyzeDoji(candles, trendLookback = 5) {
    if (candles.length < 20 + trendLookback) {
        return { signal: "WAIT", confidence: 0, reason: "Doji needs more candles for trend context", value: {} };
    }

    const current = candles.at(-1);
    const range = current.high - current.low;
    const body = Math.abs(current.close - current.open);

    if (range <= 0 || body / range > 0.1) {
        return { signal: "WAIT", confidence: 0, reason: "Not a doji", value: { body, range } };
    }

    const closes = candles.map(c => c.close);
    const ema20 = calculateEMA(closes, 20);
    const recentEma = ema20.slice(-trendLookback);
    const emaSlope = recentEma.at(-1) - recentEma[0];

    if (emaSlope > 0) {
        return { signal: "SELL", confidence: 40, reason: "Doji after uptrend - possible exhaustion", value: { body, range } };
    }
    if (emaSlope < 0) {
        return { signal: "BUY", confidence: 40, reason: "Doji after downtrend - possible exhaustion", value: { body, range } };
    }

    return { signal: "WAIT", confidence: 15, reason: "Doji in flat market", value: { body, range } };
}
