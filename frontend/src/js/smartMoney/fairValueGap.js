// Fair Value Gap (FVG): a 3-candle imbalance where the middle candle moves
// so sharply that candle 1 and candle 3 don't overlap, leaving a gap in
// traded price. Unlike order blocks/sweeps/breakers in this folder, an FVG
// existing is an OBJECTIVE FACT about the candles - no assumption about
// institutional intent required, it's just arithmetic on three highs/lows.
// The trading heuristic is a separate, smaller claim: that price tends to
// return and "fill" these gaps before continuing. That's the part this
// module discounts for (a lighter weight than the other smartMoney/
// modules, since only that second claim is an assumption, not the gap's
// existence itself).

const MIN_GAP_LOOKBACK = 5;
const WEIGHT = 0.75;

// Scans for every 3-candle gap in the window and tracks how much of each
// has since been "filled" by later price action.
export function detectFairValueGaps(candles, lookback = 100) {
    const recent = candles.slice(-lookback);
    if (recent.length < MIN_GAP_LOOKBACK) return [];

    const gaps = [];
    for (let i = 2; i < recent.length; i += 1) {
        const c1 = recent[i - 2];
        const c3 = recent[i];

        if (c1.high < c3.low) {
            gaps.push({ type: "bullish", top: c3.low, bottom: c1.high, formedAtIndex: i });
        } else if (c1.low > c3.high) {
            gaps.push({ type: "bearish", top: c1.low, bottom: c3.high, formedAtIndex: i });
        }
    }

    for (const gap of gaps) {
        const gapSize = gap.top - gap.bottom;
        if (gapSize <= 0) {
            gap.filledPercent = 100;
            continue;
        }

        const after = recent.slice(gap.formedAtIndex + 1);
        if (gap.type === "bullish") {
            // Filled from the top down - track the deepest low that's traded back into the zone.
            const deepestLow = after.reduce((min, c) => Math.min(min, c.low), gap.top);
            gap.filledPercent = Math.round(Math.max(0, Math.min(100, ((gap.top - deepestLow) / gapSize) * 100)));
        } else {
            // Filled from the bottom up - track the highest high that's traded back into the zone.
            const highestHigh = after.reduce((max, c) => Math.max(max, c.high), gap.bottom);
            gap.filledPercent = Math.round(Math.max(0, Math.min(100, ((highestHigh - gap.bottom) / gapSize) * 100)));
        }
    }

    return gaps;
}

// Returns the standard { signal, confidence, reason, value, weight }
// contract - finds the most recent gap that isn't fully filled AND that
// current price is presently sitting inside (the "retest" moment), and
// signals continuation in the gap's original direction. An untouched gap
// price isn't near yet doesn't vote - there's nothing actionable about a
// gap the market hasn't come back to test.
export function analyzeFairValueGaps(candles, lookback = 100) {
    if (!candles.length) {
        return { signal: "WAIT", confidence: 0, reason: "No candle data", value: { gaps: [] }, weight: WEIGHT };
    }

    const gaps = detectFairValueGaps(candles, lookback);
    const price = candles.at(-1).close;
    const active = gaps.filter(g => g.filledPercent < 100 && price <= g.top && price >= g.bottom);

    if (!active.length) {
        return {
            signal: "WAIT",
            confidence: 0,
            reason: gaps.length ? "Fair value gaps present, price not testing one" : "No fair value gaps in range",
            value: { gaps },
            weight: WEIGHT
        };
    }

    active.sort((a, b) => b.formedAtIndex - a.formedAtIndex);
    const gap = active[0];
    const freshness = 1 - gap.filledPercent / 100; // 1 = untouched until now, close to 0 = nearly fully filled already
    const confidence = Math.round(Math.min(75, 45 + freshness * 25));

    return {
        signal: gap.type === "bullish" ? "BUY" : "SELL",
        confidence,
        reason: `Price retesting ${gap.type} fair value gap (${gap.filledPercent}% filled)`,
        value: { gap, allGaps: gaps },
        weight: WEIGHT
    };
}
