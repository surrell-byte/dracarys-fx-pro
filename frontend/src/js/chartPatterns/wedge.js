import { findSwingPoints } from "@analysis/marketStructure.js";
import { linearRegression, slopePercentPerCandle, maxResidualPercent, empty } from "./common.js";

const MIN_TOUCHES = 3;
const MAX_RESIDUAL_PERCENT = 1.5;
const MIN_SLOPE_PERCENT = 0.05; // both boundaries must actually be sloping, not flat (that's a triangle/channel)
const CONVERGENCE_MARGIN_PERCENT = 0.02;
const BREAKOUT_BUFFER_PERCENT = 0.15;

// A wedge is a triangle where BOTH boundaries slope the same direction
// (unlike a triangle, where at least one is flat) but still converge —
// rising wedge: both boundaries climb, but support climbs faster than
// resistance. Falling wedge: both fall, but resistance falls faster than
// support. Direction is only ever reported once price actually breaks a
// boundary, same reasoning as triangle.js.
export function detectWedge(candles, lookback = 80) {
    const recent = candles.slice(-lookback);
    if (recent.length < MIN_TOUCHES * 2 + 5) return empty("Wedge");

    const { highs, lows } = findSwingPoints(recent);
    if (highs.length < MIN_TOUCHES || lows.length < MIN_TOUCHES) return empty("Wedge");

    const avgPrice = recent.reduce((s, c) => s + c.close, 0) / recent.length;
    const highPoints = highs.map(p => ({ index: p.index, price: p.price }));
    const lowPoints = lows.map(p => ({ index: p.index, price: p.price }));
    const highFit = linearRegression(highPoints);
    const lowFit = linearRegression(lowPoints);
    if (!highFit || !lowFit) return empty("Wedge");

    const highResidual = maxResidualPercent(highPoints, highFit, avgPrice);
    const lowResidual = maxResidualPercent(lowPoints, lowFit, avgPrice);
    if (highResidual > MAX_RESIDUAL_PERCENT || lowResidual > MAX_RESIDUAL_PERCENT) return empty("Wedge");

    const highSlopePct = slopePercentPerCandle(highFit.slope, avgPrice);
    const lowSlopePct = slopePercentPerCandle(lowFit.slope, avgPrice);
    const converging = highSlopePct < lowSlopePct - CONVERGENCE_MARGIN_PERCENT;
    if (!converging) return empty("Wedge");

    let shape = null;
    if (highSlopePct > MIN_SLOPE_PERCENT && lowSlopePct > MIN_SLOPE_PERCENT) shape = "Rising Wedge";
    else if (highSlopePct < -MIN_SLOPE_PERCENT && lowSlopePct < -MIN_SLOPE_PERCENT) shape = "Falling Wedge";
    if (!shape) return empty("Wedge"); // converging but mixed-sign slopes — that's a symmetrical triangle's territory, not a wedge

    const currentIndex = recent.length - 1;
    const price = candles.at(-1).close;
    const upperAtNow = highFit.slope * currentIndex + highFit.intercept;
    const lowerAtNow = lowFit.slope * currentIndex + lowFit.intercept;
    const fitQuality = 1 - Math.max(highResidual, lowResidual) / MAX_RESIDUAL_PERCENT;
    const value = { upperAtNow, lowerAtNow, shape };

    if (price > upperAtNow * (1 + BREAKOUT_BUFFER_PERCENT / 100)) {
        const confidence = Math.round(Math.min(80, 50 + fitQuality * 25));
        return { detected: true, confidence, direction: "BUY", pattern: `${shape} (breakout)`, reason: `${shape} broken to the upside`, value };
    }
    if (price < lowerAtNow * (1 - BREAKOUT_BUFFER_PERCENT / 100)) {
        const confidence = Math.round(Math.min(80, 50 + fitQuality * 25));
        return { detected: true, confidence, direction: "SELL", pattern: `${shape} (breakdown)`, reason: `${shape} broken to the downside`, value };
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

