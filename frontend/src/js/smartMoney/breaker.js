// HEURISTIC, NOT VERIFIED INSTITUTIONAL ORDER DATA. A "breaker block" (ICT
// terminology) is an order block that failed to hold - price closed
// straight through it - and is theorized to then act as support/resistance
// in the OPPOSITE direction on a later retest (the idea being the orders
// that failed there get replaced by orders on the other side). Same
// limitation as orderBlocks.js: there's no order-flow data here to confirm
// that story, only the price-action footprint of "zone got closed through,
// then retested from the other side." That geometry is real; the
// role-flip narrative is the unverified leap, so this carries the same
// "(heuristic)" tag and weight discount as the rest of this folder.

import { detectOrderBlocks } from "@smartMoney/orderBlocks.js";

const LOOKBACK = 80;
const MAX_CONFIDENCE = 50; // slightly below orderBlocks.js itself - this is a heuristic layered on top of a heuristic
const WEIGHT = 0.4;

// Finds order block zones that have since been invalidated (price closed
// fully through the zone in the direction opposite the zone's original
// bias) and marks them as breaker candidates with a flipped bias.
export function detectBreakerBlocks(candles, lookback = LOOKBACK) {
    const recent = candles.slice(-lookback);
    const zones = detectOrderBlocks(recent, lookback);
    const breakers = [];

    for (const zone of zones) {
        const after = recent.slice(zone.displacementIndex + 1);
        const brokenIndexOffset = zone.type === "bullish"
            ? after.findIndex(c => c.close < zone.bottom)
            : after.findIndex(c => c.close > zone.top);

        if (brokenIndexOffset === -1) continue; // still a valid, unbroken order block - not a breaker

        breakers.push({
            // Flipped: a failed bullish (support) OB becomes bearish (resistance), and vice versa.
            type: zone.type === "bullish" ? "bearish" : "bullish",
            top: zone.top,
            bottom: zone.bottom,
            originalType: zone.type,
            brokenAtIndex: zone.displacementIndex + 1 + brokenIndexOffset
        });
    }

    return breakers;
}

// Returns the standard { signal, confidence, reason, value, weight }
// contract - votes only when price is currently retesting a breaker zone
// from its new, flipped side.
export function analyzeBreakerBlocks(candles, lookback = LOOKBACK) {
    const breakers = detectBreakerBlocks(candles, lookback);
    if (!breakers.length) {
        return {
            signal: "WAIT",
            confidence: 0,
            reason: "No breaker blocks identified (heuristic)",
            value: { breakers },
            weight: WEIGHT
        };
    }

    const price = candles.at(-1).close;
    const inZone = breakers.filter(b => price <= b.top && price >= b.bottom);

    if (!inZone.length) {
        return {
            signal: "WAIT",
            confidence: 0,
            reason: "Breaker blocks identified, price not testing one (heuristic)",
            value: { breakers },
            weight: WEIGHT
        };
    }

    inZone.sort((a, b) => b.brokenAtIndex - a.brokenAtIndex);
    const breaker = inZone[0];

    return {
        signal: breaker.type === "bullish" ? "BUY" : "SELL",
        confidence: MAX_CONFIDENCE,
        reason: `Price retesting failed ${breaker.originalType} order block, now a ${breaker.type} breaker at ${breaker.bottom.toFixed(4)}-${breaker.top.toFixed(4)} (heuristic)`,
        value: { breaker, allBreakers: breakers },
        weight: WEIGHT
    };
}
