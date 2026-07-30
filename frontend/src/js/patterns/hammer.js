import { calculateEMA } from "../indicators/indicators.js";

// Hammer/shooting star only mean something in context: a hammer after a
// downtrend is a bullish reversal signal, but the same candle shape in the
// middle of a range or an uptrend is just noise. Uses EMA20 slope over the
// prior few candles as a cheap trend-context proxy rather than assuming
// every hammer-shaped candle is meaningful.
export function analyzeHammerShootingStar(candles, trendLookback = 5) {
    if (candles.length < 20 + trendLookback) {
        return { signal: "WAIT", confidence: 0, reason: "Hammer/shooting star needs more candles for trend context", value: {} };
    }

    const closes = candles.map(c => c.close);
    const ema20 = calculateEMA(closes, 20);
    const current = candles.at(-1);

    const body = Math.abs(current.close - current.open);
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);

    const isHammerShape = lowerWick > body * 2 && upperWick <= body * 0.5;
    const isShootingStarShape = upperWick > body * 2 && lowerWick <= body * 0.5;

    if (!isHammerShape && !isShootingStarShape) {
        return { signal: "WAIT", confidence: 0, reason: "No hammer/shooting star shape", value: {} };
    }

    const recentEma = ema20.slice(-trendLookback);
    const emaSlope = recentEma.at(-1) - recentEma[0];
    const priorDowntrend = emaSlope < 0;
    const priorUptrend = emaSlope > 0;

    if (isHammerShape && priorDowntrend) {
        return { signal: "BUY", confidence: 70, reason: "Hammer after downtrend", value: { body, lowerWick, upperWick } };
    }
    if (isShootingStarShape && priorUptrend) {
        return { signal: "SELL", confidence: 70, reason: "Shooting star after uptrend", value: { body, lowerWick, upperWick } };
    }

    return { signal: "WAIT", confidence: 20, reason: "Hammer/shooting star shape without matching trend context", value: { body, lowerWick, upperWick } };
}
