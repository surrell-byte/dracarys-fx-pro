// HEURISTIC. "Mitigation" (ICT terminology) is the idea that an order
// block's untraded orders get partially filled ("mitigated") each time
// price returns to the zone, so a zone weakens with every retest instead
// of remaining equally strong forever. orderBlocks.js already votes on any
// retest of an unbroken zone; this module's distinct job is to check HOW
// MANY times that zone has already been retested before now, and decay
// confidence accordingly - a genuinely different, falsifiable question
// (count of prior touches) layered on the same unverifiable premise as
// orderBlocks.js (that the zone reflects real institutional interest at
// all), so it keeps the same "(heuristic)" tag and weight discount.

import { detectOrderBlocks } from "@smartMoney/orderBlocks.js";

const LOOKBACK = 80;
const MAX_CONFIDENCE = 55; // first-touch ceiling, matches orderBlocks.js
const EXHAUSTION_TOUCHES = 3; // a zone tested this many times before now is treated as used up
const WEIGHT = 0.5;

// Counts how many separate prior candles closed inside the zone before the
// current candle (i.e. touches that happened BEFORE the retest being
// evaluated right now), so a zone being tested for the very first time
// scores 0 prior touches.
function countPriorTouches(recent, zone) {
    const afterFormation = recent.slice(zone.formedAtIndex + 1, -1); // exclude the current, live candle
    let touches = 0;
    let wasInside = false;

    for (const c of afterFormation) {
        const inside = c.close <= zone.top && c.close >= zone.bottom;
        if (inside && !wasInside) touches += 1; // count entries into the zone, not every candle spent inside it
        wasInside = inside;
    }

    return touches;
}

// Returns the standard { signal, confidence, reason, value, weight }
// contract - same "is price in a zone" logic as orderBlocks.js, but scores
// confidence down as prior-touch count rises, and abstains once a zone is
// considered exhausted.
export function analyzeMitigation(candles, lookback = LOOKBACK) {
    const recent = candles.slice(-lookback);
    const zones = detectOrderBlocks(recent, lookback);
    if (!zones.length) {
        return {
            signal: "WAIT",
            confidence: 0,
            reason: "No order block zones to check mitigation on (heuristic)",
            value: { zones },
            weight: WEIGHT
        };
    }

    const price = recent.at(-1).close;
    const inZone = zones.filter(z => price <= z.top && price >= z.bottom);
    if (!inZone.length) {
        return {
            signal: "WAIT",
            confidence: 0,
            reason: "No order block zone currently being tested (heuristic)",
            value: { zones },
            weight: WEIGHT
        };
    }

    inZone.sort((a, b) => b.formedAtIndex - a.formedAtIndex);
    const zone = inZone[0];
    const priorTouches = countPriorTouches(recent, zone);

    if (priorTouches >= EXHAUSTION_TOUCHES) {
        return {
            signal: "WAIT",
            confidence: 0,
            reason: `Order block already retested ${priorTouches}x, treated as exhausted (heuristic)`,
            value: { zone, priorTouches },
            weight: WEIGHT
        };
    }

    const decay = priorTouches / EXHAUSTION_TOUCHES; // 0 = fresh, approaching 1 = nearly exhausted
    const confidence = Math.round(MAX_CONFIDENCE * (1 - decay * 0.6));

    return {
        signal: zone.type === "bullish" ? "BUY" : "SELL",
        confidence,
        reason: priorTouches === 0
            ? `First mitigation of ${zone.type} order block at ${zone.bottom.toFixed(4)}-${zone.top.toFixed(4)} (heuristic)`
            : `${zone.type} order block retest #${priorTouches + 1}, confidence decayed (heuristic)`,
        value: { zone, priorTouches },
        weight: WEIGHT
    };
}
