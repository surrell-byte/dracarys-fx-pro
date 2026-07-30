import { calculateRSI } from "./indicators.js";

export function analyzeRsi(closes, period = 14) {
    const rsi = calculateRSI(closes, period).at(-1);

    if (!Number.isFinite(rsi)) {
        return { signal: "WAIT", confidence: 0, reason: "RSI not ready", value: { rsi: null } };
    }

    if (rsi <= 30) {
        // Deeper into oversold = higher confidence, capped at 85.
        const confidence = Math.round(Math.min(85, 55 + (30 - rsi)));
        return { signal: "BUY", confidence, reason: `RSI oversold (${rsi.toFixed(1)})`, value: { rsi } };
    }

    if (rsi >= 70) {
        const confidence = Math.round(Math.min(85, 55 + (rsi - 70)));
        return { signal: "SELL", confidence, reason: `RSI overbought (${rsi.toFixed(1)})`, value: { rsi } };
    }

    // Mild lean in the 30-70 band: below 50 tilts SELL exhaustion fading,
    // above 50 tilts BUY momentum continuing, but with low confidence since
    // this isn't an extreme reading.
    const signal = rsi >= 50 ? "BUY" : "SELL";
    const confidence = Math.round(20 + Math.abs(rsi - 50) * 0.6);
    return { signal, confidence, reason: `RSI neutral (${rsi.toFixed(1)})`, value: { rsi } };
}
