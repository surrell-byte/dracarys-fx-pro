import { findSwingPoints } from "./marketStructure.js";

// Real trendline detection, not "connect two highs": fits a least-squares
// regression line through the recent swing highs (resistance) and swing
// lows (support), then only trusts the result if it clears two real bars:
//
//   1. MIN_TOUCHES - enough pivot points went into the fit that it isn't
//      just two arbitrary points defining a line by construction.
//   2. MIN_FIT_QUALITY - an R^2 threshold. A line with a poor fit is
//      curve-fit noise dressed up as a trendline; below this it's discarded
//      rather than reported with false confidence.
//
// A line is also required to actually slope in the expected direction
// (support rising, resistance falling) by more than a small epsilon -
// a flat or wrong-way "trendline" is either noise or just the horizontal
// support/resistance already covered by marketStructure.js's
// analyzeSupportResistance, not a genuine diagonal trendline.
const MIN_TOUCHES = 3;
const MIN_FIT_QUALITY = 0.75;
const MIN_SLOPE_PERCENT_PER_CANDLE = 0.05; // as % of price, per candle

function leastSquaresFit(points) {
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.index, 0);
    const sumY = points.reduce((s, p) => s + p.price, 0);
    const meanX = sumX / n;
    const meanY = sumY / n;

    let num = 0;
    let den = 0;
    for (const p of points) {
        num += (p.index - meanX) * (p.price - meanY);
        den += (p.index - meanX) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;

    let ssTot = 0;
    let ssRes = 0;
    for (const p of points) {
        const predicted = slope * p.index + intercept;
        ssRes += (p.price - predicted) ** 2;
        ssTot += (p.price - meanY) ** 2;
    }
    const rSquared = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;

    return { slope, intercept, rSquared };
}

function fitTrendline(points, expectedSign, avgPrice) {
    if (points.length < MIN_TOUCHES) return null;

    const fit = leastSquaresFit(points);
    if (fit.rSquared < MIN_FIT_QUALITY) return null;

    const slopePercentPerCandle = (fit.slope / avgPrice) * 100;
    const meetsSlopeThreshold = Math.abs(slopePercentPerCandle) >= MIN_SLOPE_PERCENT_PER_CANDLE;
    const correctDirection = expectedSign > 0 ? fit.slope > 0 : fit.slope < 0;

    if (!meetsSlopeThreshold || !correctDirection) return null;

    return { ...fit, touches: points.length };
}

// Returns the same { signal, confidence, reason, value } contract as every
// other module in this pipeline, so it drops straight into
// ai/confidence.js without special-casing.
export function analyzeTrendline(candles, lookback = 80) {
    const recent = candles.slice(-lookback);
    if (recent.length < MIN_TOUCHES * 2) {
        return { signal: "WAIT", confidence: 0, reason: "Not enough candles for trendline fitting", value: {} };
    }

    const { highs, lows } = findSwingPoints(recent);
    const price = candles.at(-1).close;
    const avgPrice = recent.reduce((s, c) => s + c.close, 0) / recent.length;

    const supportLine = fitTrendline(
        lows.map(p => ({ index: p.index, price: p.price })),
        1,
        avgPrice
    );
    const resistanceLine = fitTrendline(
        highs.map(p => ({ index: p.index, price: p.price })),
        -1,
        avgPrice
    );

    if (!supportLine && !resistanceLine) {
        return { signal: "WAIT", confidence: 0, reason: "No statistically valid trendline in range", value: {} };
    }

    const currentIndex = recent.length - 1;
    const candidates = [];

    if (supportLine) {
        const projected = supportLine.slope * currentIndex + supportLine.intercept;
        const distancePercent = Math.abs(price - projected) / price;
        const fitPercent = Math.round(supportLine.rSquared * 100);

        if (price < projected * 0.995) {
            candidates.push({
                signal: "SELL",
                confidence: Math.round(Math.min(75, 45 + supportLine.rSquared * 30)),
                reason: `Rising support trendline broken (${supportLine.touches} touches, fit ${fitPercent}%)`
            });
        } else if (distancePercent <= 0.01) {
            candidates.push({
                signal: "BUY",
                confidence: Math.round(Math.min(80, 50 + supportLine.rSquared * 30)),
                reason: `Price at rising support trendline (${supportLine.touches} touches, fit ${fitPercent}%)`
            });
        }
    }

    if (resistanceLine) {
        const projected = resistanceLine.slope * currentIndex + resistanceLine.intercept;
        const distancePercent = Math.abs(price - projected) / price;
        const fitPercent = Math.round(resistanceLine.rSquared * 100);

        if (price > projected * 1.005) {
            candidates.push({
                signal: "BUY",
                confidence: Math.round(Math.min(75, 45 + resistanceLine.rSquared * 30)),
                reason: `Falling resistance trendline broken (${resistanceLine.touches} touches, fit ${fitPercent}%)`
            });
        } else if (distancePercent <= 0.01) {
            candidates.push({
                signal: "SELL",
                confidence: Math.round(Math.min(80, 50 + resistanceLine.rSquared * 30)),
                reason: `Price at falling resistance trendline (${resistanceLine.touches} touches, fit ${fitPercent}%)`
            });
        }
    }

    if (!candidates.length) {
        return {
            signal: "WAIT",
            confidence: 15,
            reason: "Valid trendline(s) present, price not near either",
            value: { supportLine, resistanceLine }
        };
    }

    // If a support bounce and a resistance rejection both trigger at once
    // (can happen in a tight, converging range), go with whichever fit is
    // more statistically confident rather than arbitrarily picking one.
    candidates.sort((a, b) => b.confidence - a.confidence);
    return { ...candidates[0], value: { supportLine, resistanceLine } };
}
