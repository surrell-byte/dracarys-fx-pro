// Tweezer top/bottom: two consecutive candles sharing (almost) the same
// high (top, bearish) or low (bottom, bullish), with each candle's body
// opposing the other's — distinct from engulfing, which requires one body
// to fully contain the other rather than matching wicks.
export function analyzeTweezers(candles, tolerancePercent = 0.05) {
    if (candles.length < 2) {
        return { signal: "WAIT", confidence: 0, reason: "Tweezers need 2 candles", value: {} };
    }

    const prev = candles.at(-2);
    const current = candles.at(-1);
    const avgPrice = (prev.close + current.close) / 2;
    const tolerance = avgPrice * (tolerancePercent / 100);

    const sameHigh = Math.abs(prev.high - current.high) <= tolerance;
    const sameLow = Math.abs(prev.low - current.low) <= tolerance;

    const prevBullish = prev.close > prev.open;
    const currentBearish = current.close < current.open;
    const prevBearish = prev.close < prev.open;
    const currentBullish = current.close > current.open;

    if (sameHigh && prevBullish && currentBearish) {
        return { signal: "SELL", confidence: 60, reason: "Tweezer top at matching highs", value: { high: current.high } };
    }
    if (sameLow && prevBearish && currentBullish) {
        return { signal: "BUY", confidence: 60, reason: "Tweezer bottom at matching lows", value: { low: current.low } };
    }

    return { signal: "WAIT", confidence: 0, reason: "No tweezer pattern", value: {} };
}
