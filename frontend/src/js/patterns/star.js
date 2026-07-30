// Morning star (bullish reversal) / evening star (bearish reversal): a
// strong trend candle, then a small-bodied indecision candle, then a strong
// candle in the opposite direction closing well into the first candle's
// body. Gap requirements are relaxed here (not all assets/timeframes gap
// cleanly) — the small-middle-candle + strong-reversal-close shape is what's
// actually checked.
export function analyzeStar(candles) {
    if (candles.length < 3) {
        return { signal: "WAIT", confidence: 0, reason: "Star pattern needs 3 candles", value: {} };
    }

    const [first, middle, third] = candles.slice(-3);
    const firstBody = Math.abs(first.close - first.open);
    const middleBody = Math.abs(middle.close - middle.open);
    const thirdBody = Math.abs(third.close - third.open);

    const middleIsSmall = firstBody > 0 && middleBody / firstBody < 0.4;
    if (!middleIsSmall) {
        return { signal: "WAIT", confidence: 0, reason: "Middle candle not small enough for star pattern", value: {} };
    }

    const firstBearish = first.close < first.open;
    const thirdBullish = third.close > third.open;
    const thirdClosesIntoFirstBull = third.close > (first.open + first.close) / 2;

    if (firstBearish && thirdBullish && thirdClosesIntoFirstBull && thirdBody > 0) {
        const confidence = Math.round(Math.min(80, 55 + (thirdBody / Math.max(firstBody, 1e-9)) * 15));
        return { signal: "BUY", confidence, reason: "Morning star reversal pattern", value: { firstBody, middleBody, thirdBody } };
    }

    const firstBullish = first.close > first.open;
    const thirdBearish = third.close < third.open;
    const thirdClosesIntoFirstBear = third.close < (first.open + first.close) / 2;

    if (firstBullish && thirdBearish && thirdClosesIntoFirstBear && thirdBody > 0) {
        const confidence = Math.round(Math.min(80, 55 + (thirdBody / Math.max(firstBody, 1e-9)) * 15));
        return { signal: "SELL", confidence, reason: "Evening star reversal pattern", value: { firstBody, middleBody, thirdBody } };
    }

    return { signal: "WAIT", confidence: 0, reason: "No star pattern confirmed", value: {} };
}
