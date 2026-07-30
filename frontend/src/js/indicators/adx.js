import { calculateADX } from "./indicators.js";

// ADX itself doesn't have a direction (it measures trend *strength*, not
// which way), so it votes with the side +DI/-DI already favor, and its
// confidence reflects how strong the trend is — low ADX genuinely means
// "I don't have an opinion", not a coin-flip BUY or SELL.
export function analyzeAdx(highs, lows, closes, period = 14) {
    const latest = calculateADX(highs, lows, closes, period).at(-1);

    if (!latest) {
        return { signal: "WAIT", confidence: 0, reason: "ADX not ready", value: { adx: null, pdi: null, mdi: null } };
    }

    const { adx, pdi, mdi } = latest;

    if (adx < 18) {
        return { signal: "WAIT", confidence: Math.round(15 + adx), reason: `ADX ${adx.toFixed(1)} — no clear trend`, value: { adx, pdi, mdi } };
    }

    const signal = pdi > mdi ? "BUY" : "SELL";
    const confidence = Math.round(Math.min(85, 30 + adx));
    return { signal, confidence, reason: `ADX ${adx.toFixed(1)} confirms trend`, value: { adx, pdi, mdi } };
}
