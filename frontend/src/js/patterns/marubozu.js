// Marubozu: a full-bodied candle with little to no wick on either end —
// signals strong one-sided conviction for that single candle, read as a
// continuation vote in the direction of the body.
export function analyzeMarubozu(candles, wickTolerancePercent = 5) {
    const current = candles.at(-1);
    const range = current.high - current.low;

    if (range <= 0) {
        return { signal: "WAIT", confidence: 0, reason: "Zero range candle", value: {} };
    }

    const body = Math.abs(current.close - current.open);
    const upperWick = current.high - Math.max(current.open, current.close);
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const wickAllowance = range * (wickTolerancePercent / 100);

    const isMarubozu = upperWick <= wickAllowance && lowerWick <= wickAllowance && body / range >= 0.9;

    if (!isMarubozu) {
        return { signal: "WAIT", confidence: 0, reason: "No marubozu pattern", value: { body, range } };
    }

    if (current.close > current.open) {
        return { signal: "BUY", confidence: 65, reason: "Bullish marubozu - strong buying conviction", value: { body, range } };
    }
    return { signal: "SELL", confidence: 65, reason: "Bearish marubozu - strong selling conviction", value: { body, range } };
}
