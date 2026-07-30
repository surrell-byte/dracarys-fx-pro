import { calculateMACD } from "./indicators.js";

export function analyzeMacd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const macd = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod).at(-1);

    if (!macd) {
        return { signal: "WAIT", confidence: 0, reason: "MACD not ready", value: { histogram: null } };
    }

    const { MACD: macdLine, signal: signalLine, histogram } = macd;
    // Normalize the histogram against the MACD line's own scale so this
    // works reasonably across assets with very different price magnitudes
    // (BTC vs a low-priced altcoin) without hardcoded thresholds.
    const scale = Math.max(Math.abs(macdLine), Math.abs(signalLine), 1e-9);
    const strength = Math.abs(histogram) / scale;
    const confidence = Math.round(Math.min(85, 45 + strength * 60));

    if (histogram > 0) {
        return { signal: "BUY", confidence, reason: "MACD histogram positive", value: { macdLine, signalLine, histogram } };
    }
    if (histogram < 0) {
        return { signal: "SELL", confidence, reason: "MACD histogram negative", value: { macdLine, signalLine, histogram } };
    }
    return { signal: "WAIT", confidence: 25, reason: "MACD flat", value: { macdLine, signalLine, histogram } };
}
