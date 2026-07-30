import { findSwingPoints } from "@analysis/marketStructure.js";
import { pricesRoughlyEqual, empty } from "./common.js";

const TOP_TOLERANCE_PERCENT = 0.8; // how close two swing highs must be to count as "the same level"
const MIN_SEPARATION = 4; // candles between the two tops, so one noisy peak can't count as two
const NEAR_TOP_PROXIMITY_PERCENT = 1.0;
const MIN_DEPTH_PERCENT = 1.5; // neckline must sit meaningfully below the tops, filters out noise-sized wiggles
const RECENCY_CANDLES = 20; // the breakdown must follow the second top within this many candles — otherwise
                             // "price is below some neckline from way earlier" is just ordinary drift, not this pattern

// Only ever looks at the two MOST RECENT swing highs. An older third peak
// further back doesn't make this "more of a double top" - it's a different
// (or non-) pattern, and pulling it in would just be curve-fitting the
// label onto whatever shape happened to be convenient.
export function detectDoubleTop(candles, lookback = 80) {
    const recent = candles.slice(-lookback);
    if (recent.length < 20) return empty("Double Top");

    const { highs, lows } = findSwingPoints(recent);
    if (highs.length < 2 || !lows.length) return empty("Double Top");

    const secondTop = highs.at(-1);
    const firstTop = highs.at(-2);

    if (secondTop.index - firstTop.index < MIN_SEPARATION) return empty("Double Top");
    if (!pricesRoughlyEqual(firstTop.price, secondTop.price, TOP_TOLERANCE_PERCENT)) return empty("Double Top");

    const between = lows.filter(l => l.index > firstTop.index && l.index < secondTop.index);
    if (!between.length) return empty("Double Top");

    const neckline = Math.min(...between.map(l => l.price));
    const depthPercent = ((Math.min(firstTop.price, secondTop.price) - neckline) / neckline) * 100;
    if (depthPercent < MIN_DEPTH_PERCENT) return empty("Double Top"); // too shallow to be a real reversal shape, not just noise

    const price = candles.at(-1).close;
    const currentIndex = recent.length - 1;
    const relativeDiffPercent = (Math.abs(firstTop.price - secondTop.price) / ((firstTop.price + secondTop.price) / 2)) * 100;
    const topSimilarity = 1 - relativeDiffPercent / TOP_TOLERANCE_PERCENT;
    const value = { firstTop: firstTop.price, secondTop: secondTop.price, neckline };

    const withinRecency = currentIndex - secondTop.index <= RECENCY_CANDLES;

    if (price < neckline && withinRecency) {
        const confidence = Math.round(Math.min(85, 55 + topSimilarity * 20 + Math.min(depthPercent, 10)));
        return {
            detected: true,
            confidence,
            direction: "SELL",
            pattern: "Double Top",
            reason: `Double top confirmed — neckline ${neckline.toFixed(4)} broken`,
            value
        };
    }

    const nearSecondTop = Math.abs(price - secondTop.price) / secondTop.price <= NEAR_TOP_PROXIMITY_PERCENT / 100;
    if (nearSecondTop) {
        const confidence = Math.round(Math.min(55, 30 + topSimilarity * 20));
        return {
            detected: true,
            confidence,
            direction: "SELL",
            pattern: "Double Top (forming)",
            reason: `Price rejected again near prior top ${secondTop.price.toFixed(4)}, neckline ${neckline.toFixed(4)} not yet broken`,
            value
        };
    }

    return { detected: true, confidence: 0, direction: null, pattern: "Double Top", reason: "Two matching tops present, not actionable yet", value };
}

