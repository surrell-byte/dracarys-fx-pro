import { calculateBB } from "./indicators.js";

export function analyzeBollinger(closes, period = 20, stdDev = 2) {
    const bb = calculateBB(closes, period, stdDev).at(-1);
    const price = closes.at(-1);

    if (!bb || !Number.isFinite(price)) {
        return { signal: "WAIT", confidence: 0, reason: "Bollinger Bands not ready", value: { ...bb } };
    }

    const bandWidth = bb.upper - bb.lower;
    if (bandWidth <= 0) {
        return { signal: "WAIT", confidence: 0, reason: "Bands collapsed", value: bb };
    }

    // Where price sits inside the band, 0 = lower band, 1 = upper band.
    const position = (price - bb.lower) / bandWidth;

    if (position <= 0.05) {
        const confidence = Math.round(Math.min(85, 55 + (0.05 - position) * 400));
        return { signal: "BUY", confidence, reason: "Price at/below lower band", value: bb };
    }
    if (position >= 0.95) {
        const confidence = Math.round(Math.min(85, 55 + (position - 0.95) * 400));
        return { signal: "SELL", confidence, reason: "Price at/above upper band", value: bb };
    }

    return { signal: "WAIT", confidence: 20, reason: "Price inside bands", value: bb };
}
