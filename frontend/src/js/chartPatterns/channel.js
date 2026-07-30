import { findSwingPoints } from "@analysis/marketStructure.js";
import { linearRegression, slopePercentPerCandle, maxResidualPercent, empty } from "./common.js";

const MIN_TOUCHES = 4; // a channel needs more confirming touches than a triangle/wedge — it's a weaker, more common shape otherwise
const MAX_RESIDUAL_PERCENT = 1.0;
const PARALLEL_TOLERANCE_PERCENT = 0.03; // max slope difference (%/candle) to call the two boundaries "parallel"
const FLAT_SLOPE_THRESHOLD_PERCENT = 0.02;
const BREAKOUT_BUFFER_PERCENT = 0.15;
const BAND_ZONE = 0.08; // within the outer 8% of the channel counts as "at the band"

// Unlike triangle/wedge, a channel's boundaries run roughly PARALLEL rather
// than converging — so instead of waiting for a squeeze to resolve, this
// trades the channel itself: BUY near the lower band, SELL near the upper
// band, with a stronger signal on an outright break of either boundary.
export function detectChannel(candles, lookback = 80) {
    const recent = candles.slice(-lookback);
    if (recent.length < MIN_TOUCHES * 2 + 5) return empty("Channel");

    const { highs, lows } = findSwingPoints(recent);
    if (highs.length < MIN_TOUCHES || lows.length < MIN_TOUCHES) return empty("Channel");

    const avgPrice = recent.reduce((s, c) => s + c.close, 0) / recent.length;
    const highPoints = highs.map(p => ({ index: p.index, price: p.price }));
    const lowPoints = lows.map(p => ({ index: p.index, price: p.price }));
    const highFit = linearRegression(highPoints);
    const lowFit = linearRegression(lowPoints);
    if (!highFit || !lowFit) return empty("Channel");

    const highResidual = maxResidualPercent(highPoints, highFit, avgPrice);
    const lowResidual = maxResidualPercent(lowPoints, lowFit, avgPrice);
    if (highResidual > MAX_RESIDUAL_PERCENT || lowResidual > MAX_RESIDUAL_PERCENT) return empty("Channel");

    const highSlopePct = slopePercentPerCandle(highFit.slope, avgPrice);
    const lowSlopePct = slopePercentPerCandle(lowFit.slope, avgPrice);
    if (Math.abs(highSlopePct - lowSlopePct) > PARALLEL_TOLERANCE_PERCENT) return empty("Channel"); // converging/diverging — not this pattern

    const shape = highSlopePct > FLAT_SLOPE_THRESHOLD_PERCENT ? "Ascending Channel"
        : highSlopePct < -FLAT_SLOPE_THRESHOLD_PERCENT ? "Descending Channel"
        : "Horizontal Channel";

    const currentIndex = recent.length - 1;
    const price = candles.at(-1).close;
    const upperAtNow = highFit.slope * currentIndex + highFit.intercept;
    const lowerAtNow = lowFit.slope * currentIndex + lowFit.intercept;
    const channelWidth = upperAtNow - lowerAtNow;
    if (channelWidth <= 0) return empty("Channel");

    const fitQuality = 1 - Math.max(highResidual, lowResidual) / MAX_RESIDUAL_PERCENT;
    const positionInChannel = (price - lowerAtNow) / channelWidth; // 0 = at lower band, 1 = at upper band
    const value = { upperAtNow, lowerAtNow, shape, positionInChannel };

    if (price > upperAtNow * (1 + BREAKOUT_BUFFER_PERCENT / 100)) {
        return { detected: true, confidence: Math.round(Math.min(75, 45 + fitQuality * 25)), direction: "BUY", pattern: `${shape} (breakout)`, reason: `Price broke above the ${shape.toLowerCase()}`, value };
    }
    if (price < lowerAtNow * (1 - BREAKOUT_BUFFER_PERCENT / 100)) {
        return { detected: true, confidence: Math.round(Math.min(75, 45 + fitQuality * 25)), direction: "SELL", pattern: `${shape} (breakdown)`, reason: `Price broke below the ${shape.toLowerCase()}`, value };
    }
    if (positionInChannel <= BAND_ZONE) {
        return { detected: true, confidence: Math.round(Math.min(45, 20 + fitQuality * 20)), direction: "BUY", pattern: shape, reason: `Price at the lower ${shape.toLowerCase()} band`, value };
    }
    if (positionInChannel >= 1 - BAND_ZONE) {
        return { detected: true, confidence: Math.round(Math.min(45, 20 + fitQuality * 20)), direction: "SELL", pattern: shape, reason: `Price at the upper ${shape.toLowerCase()} band`, value };
    }

    return { detected: true, confidence: 10, direction: null, pattern: shape, reason: `Inside the ${shape.toLowerCase()}, mid-range`, value };
}

