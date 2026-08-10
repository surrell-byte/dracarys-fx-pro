import { getQuality } from "./shared.js";

// Rules: mark a prior range, require price to close beyond it (not just
// wick through), and only trust the breakout if volume is >= 1.5x average.
export function scoreBreakout2({ adx, atrPercent, candles, price, volumeRatio }) {
    const reasons = [];
    const lookback = 50;
    // Exclude the current/latest candle so we're comparing the close against
    // a range that was established *before* this bar, not including it.
    const priorCandles = candles.slice(-lookback - 1, -1);

    if (!priorCandles.length) {
        return {
            buyScore: 0,
            sellScore: 0,
            penalty: 40,
            quality: "Low",
            reasons: ["Not enough range history"]
        };
    }

    let buyScore = 0;
    let sellScore = 0;
    let penalty = 0;

    const rangeHigh = Math.max(...priorCandles.map(c => c.high));
    const rangeLow = Math.min(...priorCandles.map(c => c.low));
    const brokeAbove = price > rangeHigh;
    const brokeBelow = price < rangeLow;
    const volumeConfirmed = Number.isFinite(volumeRatio) && volumeRatio >= 1.5;

    if (brokeAbove) {
        buyScore += 50;
        reasons.push("Close above prior range resistance");
        if (volumeConfirmed) {
            buyScore += 30;
            reasons.push("Volume >= 1.5x average");
        } else {
            penalty += 20;
            reasons.push("Breakout lacks volume confirmation");
        }
    } else if (brokeBelow) {
        sellScore += 50;
        reasons.push("Close below prior range support");
        if (volumeConfirmed) {
            sellScore += 30;
            reasons.push("Volume >= 1.5x average");
        } else {
            penalty += 20;
            reasons.push("Breakdown lacks volume confirmation");
        }
    } else {
        penalty += 15;
        reasons.push("Price inside range, no breakout");
    }

    if (adx?.adx >= 22) {
        if (buyScore > sellScore) buyScore += 10;
        if (sellScore > buyScore) sellScore += 10;
    }

    if (Number.isFinite(atrPercent) && atrPercent > 3) {
        penalty += 10;
        reasons.push("Volatility extended, breakout risk elevated");
    }

    const agreement = Math.abs(buyScore - sellScore);

    return {
        buyScore: Math.max(0, buyScore),
        sellScore: Math.max(0, sellScore),
        penalty,
        quality: getQuality({ adx: adx?.adx, atrPercent, volumeRatio, agreement, penalty }),
        reasons
    };
}
