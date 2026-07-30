import { findSwingPoints } from "@analysis/marketStructure.js";
import { pricesRoughlyEqual, empty } from "./common.js";

const BOTTOM_TOLERANCE_PERCENT = 0.8;
const MIN_SEPARATION = 4;
const NEAR_BOTTOM_PROXIMITY_PERCENT = 1.0;
const MIN_DEPTH_PERCENT = 1.5;
const RECENCY_CANDLES = 20;

// Mirror image of doubleTop.js — same reasoning throughout, just swing lows
// instead of swing highs and a neckline that's the highest swing high
// between the two bottoms instead of the lowest swing low between two tops.
export function detectDoubleBottom(candles, lookback = 80) {
    const recent = candles.slice(-lookback);
    if (recent.length < 20) return empty("Double Bottom");

    const { highs, lows } = findSwingPoints(recent);
    if (lows.length < 2 || !highs.length) return empty("Double Bottom");

    const secondBottom = lows.at(-1);
    const firstBottom = lows.at(-2);

    if (secondBottom.index - firstBottom.index < MIN_SEPARATION) return empty("Double Bottom");
    if (!pricesRoughlyEqual(firstBottom.price, secondBottom.price, BOTTOM_TOLERANCE_PERCENT)) return empty("Double Bottom");

    const between = highs.filter(h => h.index > firstBottom.index && h.index < secondBottom.index);
    if (!between.length) return empty("Double Bottom");

    const neckline = Math.max(...between.map(h => h.price));
    const depthPercent = ((neckline - Math.max(firstBottom.price, secondBottom.price)) / neckline) * 100;
    if (depthPercent < MIN_DEPTH_PERCENT) return empty("Double Bottom");

    const price = candles.at(-1).close;
    const currentIndex = recent.length - 1;
    const relativeDiffPercent = (Math.abs(firstBottom.price - secondBottom.price) / ((firstBottom.price + secondBottom.price) / 2)) * 100;
    const bottomSimilarity = 1 - relativeDiffPercent / BOTTOM_TOLERANCE_PERCENT;
    const value = { firstBottom: firstBottom.price, secondBottom: secondBottom.price, neckline };
    const withinRecency = currentIndex - secondBottom.index <= RECENCY_CANDLES;

    if (price > neckline && withinRecency) {
        const confidence = Math.round(Math.min(85, 55 + bottomSimilarity * 20 + Math.min(depthPercent, 10)));
        return {
            detected: true,
            confidence,
            direction: "BUY",
            pattern: "Double Bottom",
            reason: `Double bottom confirmed — neckline ${neckline.toFixed(4)} broken`,
            value
        };
    }

    const nearSecondBottom = Math.abs(price - secondBottom.price) / secondBottom.price <= NEAR_BOTTOM_PROXIMITY_PERCENT / 100;
    if (nearSecondBottom) {
        const confidence = Math.round(Math.min(55, 30 + bottomSimilarity * 20));
        return {
            detected: true,
            confidence,
            direction: "BUY",
            pattern: "Double Bottom (forming)",
            reason: `Price held again near prior low ${secondBottom.price.toFixed(4)}, neckline ${neckline.toFixed(4)} not yet broken`,
            value
        };
    }

    return { detected: true, confidence: 0, direction: null, pattern: "Double Bottom", reason: "Two matching bottoms present, not actionable yet", value };
}

