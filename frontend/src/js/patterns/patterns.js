export function bullishEngulfing(prev, current) {
    return (
        prev.close < prev.open &&
        current.close > current.open &&
        current.open < prev.close &&
        current.close > prev.open
    );
}

export function bearishEngulfing(prev, current) {
    return (
        prev.close > prev.open &&
        current.close < current.open &&
        current.open > prev.close &&
        current.close < prev.open
    );
}

export function hammer(candle) {
    const body = Math.abs(candle.close - candle.open);
    const lower = Math.min(candle.open, candle.close) - candle.low;
    const upper = candle.high - Math.max(candle.open, candle.close);

    return lower > body * 2 && upper <= body;
}

export function shootingStar(candle) {
    const body = Math.abs(candle.close - candle.open);
    const upper = candle.high - Math.max(candle.open, candle.close);
    const lower = Math.min(candle.open, candle.close) - candle.low;

    return upper > body * 2 && lower <= body;
}

export function detectPattern(prev, current) {
    if (!prev || !current) return "none";
    if (bullishEngulfing(prev, current)) return "bullish";
    if (bearishEngulfing(prev, current)) return "bearish";
    if (hammer(current)) return "bullish";
    if (shootingStar(current)) return "bearish";

    return "none";
}
