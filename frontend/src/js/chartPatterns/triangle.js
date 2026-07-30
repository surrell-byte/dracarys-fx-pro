import { findSwingPoints } from "@analysis/marketStructure.js";
import { linearRegression, slopePercentPerCandle, maxResidualPercent, empty } from "./common.js";

const MIN_TOUCHES = 3;
const MAX_RESIDUAL_PERCENT = 1.5; // every swing point must sit within this % of price of its fitted line
const FLAT_SLOPE_THRESHOLD_PERCENT = 0.02; // % per candle; below this counts as "flat" for classification
const BREAKOUT_BUFFER_PERCENT = 0.15;

// Fits a regression line through recent swing highs and another through
// recent swing lows. Classifies the shape by how each line slopes, but only
// ever calls it a "breakout" once price has actually closed beyond one of
// the two boundaries — a converging shape with no confirmed break is
// reported as "forming" with low, non-actionable confidence rather than
// guessing which way it'll resolve.
export function detectTriangle(candles, lookback = 80) {
    const recent = candles.slice(-lookback);
    if (recent.length < MIN_TOUCHES * 2 + 5) return empty("Triangle");

    const { highs, lows } = findSwingPoints(recent);
    if (highs.length < MIN_TOUCHES || lows.length < MIN_TOUCHES) return empty("Triangle");

    const avgPrice = recent.reduce((s, c) => s + c.close, 0) / recent.length;
    const highPoints = highs.map(p => ({ index: p.index, price: p.price }));
    const lowPoints = lows.map(p => ({ index: p.index, price: p.price }));
    const highFit = linearRegression(highPoints);
    const lowFit = linearRegression(lowPoints);
    if (!highFit || !lowFit) return empty("Triangle");

    const highResidual = maxResidualPercent(highPoints, highFit, avgPrice);
    const lowResidual = maxResidualPercent(lowPoints, lowFit, avgPrice);
    if (highResidual > MAX_RESIDUAL_PERCENT || lowResidual > MAX_RESIDUAL_PERCENT) return empty("Triangle");

    const highSlopePct = slopePercentPerCandle(highFit.slope, avgPrice);
    const lowSlopePct = slopePercentPerCandle(lowFit.slope, avgPrice);

    // Converging: the upper boundary isn't rising faster than the lower one
    // is — i.e. the gap between them is actually narrowing, not parallel or widening.
    const converging = highSlopePct < lowSlopePct - FLAT_SLOPE_THRESHOLD_PERCENT;
    if (!converging) return empty("Triangle");

    let shape;
    if (Math.abs(highSlopePct) <= FLAT_SLOPE_THRESHOLD_PERCENT && lowSlopePct > FLAT_SLOPE_THRESHOLD_PERCENT) {
        shape = "Ascending Triangle";
    } else if (Math.abs(lowSlopePct) <= FLAT_SLOPE_THRESHOLD_PERCENT && highSlopePct < -FLAT_SLOPE_THRESHOLD_PERCENT) {
        shape = "Descending Triangle";
    } else if (highSlopePct < 0 && lowSlopePct > 0) {
        shape = "Symmetrical Triangle";
    } else {
        return empty("Triangle"); // converging but not a recognizable triangle sub-type
    }

    const currentIndex = recent.length - 1;
    const price = candles.at(-1).close;
    const upperAtNow = highFit.slope * currentIndex + highFit.intercept;
    const lowerAtNow = lowFit.slope * currentIndex + lowFit.intercept;
    const fitQuality = 1 - Math.max(highResidual, lowResidual) / MAX_RESIDUAL_PERCENT; // 0..1, 1 = points sit right on the lines
    const value = { upperAtNow, lowerAtNow, shape };

    if (price > upperAtNow * (1 + BREAKOUT_BUFFER_PERCENT / 100)) {
        const confidence = Math.round(Math.min(80, 50 + fitQuality * 25));
        return { detected: true, confidence, direction: "BUY", pattern: `${shape} (breakout)`, reason: `${shape} resistance broken to the upside`, value };
    }
    if (price < lowerAtNow * (1 - BREAKOUT_BUFFER_PERCENT / 100)) {
        const confidence = Math.round(Math.min(80, 50 + fitQuality * 25));
        return { detected: true, confidence, direction: "SELL", pattern: `${shape} (breakdown)`, reason: `${shape} support broken to the downside`, value };
    }

    return {
        detected: true,
        confidence: Math.round(Math.min(35, 15 + fitQuality * 15)),
        direction: null,
        pattern: `${shape} (forming)`,
        reason: `${shape} converging, no breakout yet`,
        value
    };
}

