import { findSwingPoints } from "@analysis/marketStructure.js";
import { pricesRoughlyEqual, linearRegression, empty } from "./common.js";

const SHOULDER_TOLERANCE_PERCENT = 2.5;
const MIN_HEAD_PROMINENCE_PERCENT = 1.0; // head must clear both shoulders by at least this much
const NECKLINE_PROXIMITY_PERCENT = 1.5;

// The neckline connects the two swing points either side of the head. When
// there are only two of them a straight line through both is exact; when
// there are more (a choppier neckline), a regression fit is a reasonable
// approximation of where it currently sits.
function necklineAt(points, atIndex) {
    if (points.length === 1) return points[0].price;
    const fit = linearRegression(points.map(p => ({ index: p.index, price: p.price })));
    return fit ? fit.slope * atIndex + fit.intercept : points[0].price;
}

export function detectHeadAndShoulders(candles, lookback = 100) {
    const recent = candles.slice(-lookback);
    if (recent.length < 30) return empty("Head & Shoulders");

    const { highs, lows } = findSwingPoints(recent);
    if (highs.length < 3 || lows.length < 2) return empty("Head & Shoulders");

    const [leftShoulder, head, rightShoulder] = highs.slice(-3);
    const headProminent = head.price > leftShoulder.price * (1 + MIN_HEAD_PROMINENCE_PERCENT / 100)
        && head.price > rightShoulder.price * (1 + MIN_HEAD_PROMINENCE_PERCENT / 100);
    if (!headProminent) return empty("Head & Shoulders");
    if (!pricesRoughlyEqual(leftShoulder.price, rightShoulder.price, SHOULDER_TOLERANCE_PERCENT)) return empty("Head & Shoulders");

    const necklinePoints = lows.filter(l => l.index > leftShoulder.index && l.index < rightShoulder.index);
    if (!necklinePoints.length) return empty("Head & Shoulders");

    const currentIndex = recent.length - 1;
    const neckline = necklineAt(necklinePoints, currentIndex);
    const price = candles.at(-1).close;
    const relativeDiffPercent = (Math.abs(leftShoulder.price - rightShoulder.price) / ((leftShoulder.price + rightShoulder.price) / 2)) * 100;
    const shoulderSimilarity = 1 - relativeDiffPercent / SHOULDER_TOLERANCE_PERCENT;
    const value = { leftShoulder: leftShoulder.price, head: head.price, rightShoulder: rightShoulder.price, neckline };

    if (price < neckline) {
        const confidence = Math.round(Math.min(85, 55 + shoulderSimilarity * 20));
        return {
            detected: true,
            confidence,
            direction: "SELL",
            pattern: "Head & Shoulders",
            reason: `Head & shoulders confirmed — neckline ~${neckline.toFixed(4)} broken`,
            value
        };
    }

    const nearNeckline = Math.abs(price - neckline) / neckline <= NECKLINE_PROXIMITY_PERCENT / 100;
    if (nearNeckline) {
        const confidence = Math.round(Math.min(50, 25 + shoulderSimilarity * 20));
        return {
            detected: true,
            confidence,
            direction: "SELL",
            pattern: "Head & Shoulders (forming)",
            reason: `Right shoulder formed, price approaching neckline ~${neckline.toFixed(4)}`,
            value
        };
    }

    return { detected: true, confidence: 0, direction: null, pattern: "Head & Shoulders", reason: "Shape present, not near neckline yet", value };
}

// Mirror image: shoulders/head are swing LOWS, neckline is built from the
// swing HIGHS between them, breakout direction is BUY instead of SELL.
export function detectInverseHeadAndShoulders(candles, lookback = 100) {
    const recent = candles.slice(-lookback);
    if (recent.length < 30) return empty("Inverse Head & Shoulders");

    const { highs, lows } = findSwingPoints(recent);
    if (lows.length < 3 || highs.length < 2) return empty("Inverse Head & Shoulders");

    const [leftShoulder, head, rightShoulder] = lows.slice(-3);
    const headProminent = head.price < leftShoulder.price * (1 - MIN_HEAD_PROMINENCE_PERCENT / 100)
        && head.price < rightShoulder.price * (1 - MIN_HEAD_PROMINENCE_PERCENT / 100);
    if (!headProminent) return empty("Inverse Head & Shoulders");
    if (!pricesRoughlyEqual(leftShoulder.price, rightShoulder.price, SHOULDER_TOLERANCE_PERCENT)) return empty("Inverse Head & Shoulders");

    const necklinePoints = highs.filter(h => h.index > leftShoulder.index && h.index < rightShoulder.index);
    if (!necklinePoints.length) return empty("Inverse Head & Shoulders");

    const currentIndex = recent.length - 1;
    const neckline = necklineAt(necklinePoints, currentIndex);
    const price = candles.at(-1).close;
    const relativeDiffPercent = (Math.abs(leftShoulder.price - rightShoulder.price) / ((leftShoulder.price + rightShoulder.price) / 2)) * 100;
    const shoulderSimilarity = 1 - relativeDiffPercent / SHOULDER_TOLERANCE_PERCENT;
    const value = { leftShoulder: leftShoulder.price, head: head.price, rightShoulder: rightShoulder.price, neckline };

    if (price > neckline) {
        const confidence = Math.round(Math.min(85, 55 + shoulderSimilarity * 20));
        return {
            detected: true,
            confidence,
            direction: "BUY",
            pattern: "Inverse Head & Shoulders",
            reason: `Inverse head & shoulders confirmed — neckline ~${neckline.toFixed(4)} broken`,
            value
        };
    }

    const nearNeckline = Math.abs(price - neckline) / neckline <= NECKLINE_PROXIMITY_PERCENT / 100;
    if (nearNeckline) {
        const confidence = Math.round(Math.min(50, 25 + shoulderSimilarity * 20));
        return {
            detected: true,
            confidence,
            direction: "BUY",
            pattern: "Inverse Head & Shoulders (forming)",
            reason: `Right shoulder formed, price approaching neckline ~${neckline.toFixed(4)}`,
            value
        };
    }

    return { detected: true, confidence: 0, direction: null, pattern: "Inverse Head & Shoulders", reason: "Shape present, not near neckline yet", value };
}

