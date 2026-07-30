// Follows the same { signal, confidence, reason, value } contract as the
// indicator modules in ../indicators/, so it drops into the same vote
// pipeline without the combiner needing to know it's a candlestick pattern.
export function analyzeEngulfing(candles) {
    if (candles.length < 2) {
        return { signal: "WAIT", confidence: 0, reason: "Engulfing needs 2 candles", value: {} };
    }

    const prev = candles.at(-2);
    const current = candles.at(-1);
    const prevBody = Math.abs(prev.close - prev.open);
    const currentBody = Math.abs(current.close - current.open);

    const bullish = prev.close < prev.open
        && current.close > current.open
        && current.open <= prev.close
        && current.close >= prev.open;

    const bearish = prev.close > prev.open
        && current.close < current.open
        && current.open >= prev.close
        && current.close <= prev.open;

    if (bullish) {
        // A bigger engulf relative to the prior candle's body = more conviction.
        const ratio = prevBody > 0 ? currentBody / prevBody : 1;
        const confidence = Math.round(Math.min(80, 55 + ratio * 10));
        return { signal: "BUY", confidence, reason: "Bullish engulfing candle", value: { prevBody, currentBody } };
    }
    if (bearish) {
        const ratio = prevBody > 0 ? currentBody / prevBody : 1;
        const confidence = Math.round(Math.min(80, 55 + ratio * 10));
        return { signal: "SELL", confidence, reason: "Bearish engulfing candle", value: { prevBody, currentBody } };
    }

    return { signal: "WAIT", confidence: 0, reason: "No engulfing pattern", value: {} };
}
