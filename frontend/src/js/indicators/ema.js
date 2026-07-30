import { calculateEMA } from "./indicators.js";

// Every indicator module in this folder follows the same contract:
//   { signal: "BUY" | "SELL" | "WAIT", confidence: 0-100, reason: string, value }
// so ai/confidence.js can combine any number of them without knowing
// anything about what's inside each one.
export function analyzeEma(closes, fastPeriod = 20, slowPeriod = 50) {
    const fast = calculateEMA(closes, fastPeriod).at(-1);
    const slow = calculateEMA(closes, slowPeriod).at(-1);

    if (!Number.isFinite(fast) || !Number.isFinite(slow)) {
        return {
            signal: "WAIT",
            confidence: 0,
            reason: `EMA${fastPeriod}/${slowPeriod} not ready`,
            value: { fast: null, slow: null }
        };
    }

    // Confidence scales with how far apart the two EMAs are (as a % of the
    // slow EMA), capped so a huge spread can't claim near-100% on its own —
    // this is one vote among several, not the whole answer.
    const spreadPercent = Math.abs(fast - slow) / slow;
    const confidence = Math.round(Math.min(85, 50 + spreadPercent * 4000));

    if (fast > slow) {
        return { signal: "BUY", confidence, reason: `EMA${fastPeriod} above EMA${slowPeriod}`, value: { fast, slow } };
    }
    if (fast < slow) {
        return { signal: "SELL", confidence, reason: `EMA${fastPeriod} below EMA${slowPeriod}`, value: { fast, slow } };
    }
    return { signal: "WAIT", confidence: 30, reason: "EMAs flat", value: { fast, slow } };
}
