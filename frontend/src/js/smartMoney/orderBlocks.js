// HEURISTIC, NOT VERIFIED INSTITUTIONAL ORDER DATA. An "order block" (ICT
// terminology) presumes a specific candle is where large institutional
// orders were placed just before an aggressive move, and that the same
// zone will attract orders again on a retest. This app has no order-flow
// or order-book data to confirm that - same limitation liquidity.js and
// marketStructure.js's header already document.
//
// What's actually checkable is the price-action footprint: the last
// opposing-direction candle immediately before a strong displacement move
// (a candle range well above the recent average). That's real and
// falsifiable geometry. Whether it marks genuine institutional interest is
// the unverified leap, so this carries the same "(heuristic)" tag and
// weight discount as liquidity.js and liquiditySweep.js.

const LOOKBACK = 80;
const DISPLACEMENT_ATR_MULT = 1.8; // a candle range this many times the recent average range counts as "displacement"
const ATR_SAMPLE = 14;
const MAX_ZONES = 5;
const PROXIMITY_THRESHOLD_PERCENT = 1.2; // how close price must get to a zone to vote at all
const MAX_CONFIDENCE = 55;
const WEIGHT = 0.5; // structural discount, matching liquidity.js / liquiditySweep.js

function averageRange(candles) {
    if (!candles.length) return 0;
    return candles.reduce((sum, c) => sum + (c.high - c.low), 0) / candles.length;
}

// Scans for displacement moves and records the last opposing candle before
// each one as a candidate order block zone.
export function detectOrderBlocks(candles, lookback = LOOKBACK) {
    const recent = candles.slice(-lookback);
    if (recent.length < ATR_SAMPLE + 3) return [];

    const zones = [];

    for (let i = ATR_SAMPLE + 1; i < recent.length; i += 1) {
        const sample = recent.slice(i - ATR_SAMPLE, i);
        const avgRange = averageRange(sample);
        if (avgRange <= 0) continue;

        const displacementCandle = recent[i];
        const range = displacementCandle.high - displacementCandle.low;
        if (range < avgRange * DISPLACEMENT_ATR_MULT) continue;

        const bullishDisplacement = displacementCandle.close > displacementCandle.open;
        const priorCandle = recent[i - 1];
        const priorIsOpposite = bullishDisplacement
            ? priorCandle.close < priorCandle.open
            : priorCandle.close > priorCandle.open;
        if (!priorIsOpposite) continue;

        zones.push({
            type: bullishDisplacement ? "bullish" : "bearish",
            top: priorCandle.high,
            bottom: priorCandle.low,
            formedAtIndex: i - 1,
            displacementIndex: i
        });
    }

    // Later zones are more relevant than very old ones already priced through.
    return zones.slice(-MAX_ZONES);
}

// Returns the standard { signal, confidence, reason, value, weight }
// contract - finds the freshest zone price is currently sitting inside (a
// "retest" moment) and votes continuation in the zone's original
// direction. A zone price isn't near yet doesn't vote; there's nothing
// actionable about a zone the market hasn't returned to.
export function analyzeOrderBlocks(candles, lookback = LOOKBACK) {
    if (!candles.length) {
        return { signal: "WAIT", confidence: 0, reason: "No candle data", value: { zones: [] }, weight: WEIGHT };
    }

    const zones = detectOrderBlocks(candles, lookback);
    if (!zones.length) {
        return {
            signal: "WAIT",
            confidence: 0,
            reason: "No order block zones identified (heuristic)",
            value: { zones },
            weight: WEIGHT
        };
    }

    const price = candles.at(-1).close;
    const inZone = zones.filter(z => price <= z.top && price >= z.bottom);

    if (!inZone.length) {
        // Not inside a zone - check proximity so a near-miss still surfaces
        // in the reason even though it doesn't vote.
        const nearest = [...zones].sort((a, b) => {
            const distA = Math.min(Math.abs(price - a.top), Math.abs(price - a.bottom));
            const distB = Math.min(Math.abs(price - b.top), Math.abs(price - b.bottom));
            return distA - distB;
        })[0];
        const distancePercent = (Math.min(Math.abs(price - nearest.top), Math.abs(price - nearest.bottom)) / price) * 100;

        if (distancePercent > PROXIMITY_THRESHOLD_PERCENT) {
            return {
                signal: "WAIT",
                confidence: 0,
                reason: "Order block zones identified, price not testing one (heuristic)",
                value: { zones },
                weight: WEIGHT
            };
        }

        return {
            signal: "WAIT",
            confidence: 0,
            reason: `Approaching ${nearest.type} order block near ${nearest.top.toFixed(4)}-${nearest.bottom.toFixed(4)} (heuristic)`,
            value: { zones, nearest },
            weight: WEIGHT
        };
    }

    inZone.sort((a, b) => b.formedAtIndex - a.formedAtIndex);
    const zone = inZone[0];

    return {
        signal: zone.type === "bullish" ? "BUY" : "SELL",
        confidence: MAX_CONFIDENCE,
        reason: `Price retesting ${zone.type} order block at ${zone.bottom.toFixed(4)}-${zone.top.toFixed(4)} (heuristic)`,
        value: { zone, allZones: zones },
        weight: WEIGHT
    };
}
