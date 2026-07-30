// Estimates a binary-options-style "recommended expiry" for a signal -
// i.e. how long the move is likely to take to play out, expressed as a
// human bucket (5min / 15min / 1hr / etc.) rather than a stop-loss and
// take-profit like the spot/forex side of the app uses.
//
// Primary method (data-driven): estimate how many candles it should take
// price to travel the stop-to-target distance at the current ATR-per-candle
// pace, then map that candle count to a time bucket using the scan
// timeframe. This directly uses the same risk numbers already computed
// for the trade (risk.stopDistance, risk.rewardMultiple, risk.atr) so it
// can't drift out of sync with the rest of the signal.
//
// Fallback (strategy-type based): used only when risk/ATR data isn't
// available (e.g. risk is null because ATR was missing this candle) -
// falls back to a fixed table of typical hold times per strategy
// archetype, keyed off words in the strategy label since strategies
// aren't currently tagged with an explicit "archetype" field.

const TIMEFRAME_MINUTES = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "4h": 240, "1d": 1440
};

// Ordered buckets (in minutes) that binary-options platforms commonly
// offer as expiries - the estimate snaps up to the nearest one at or
// above the raw estimate, so "we think this needs ~12 minutes" becomes
// the "15 min" bucket rather than an odd number nobody trades in.
const EXPIRY_BUCKETS = [
    { minutes: 1, label: "1 min" },
    { minutes: 5, label: "5 min" },
    { minutes: 15, label: "15 min" },
    { minutes: 30, label: "30 min" },
    { minutes: 60, label: "1 hour" },
    { minutes: 240, label: "4 hours" },
    { minutes: 1440, label: "1 day" }
];

// Fallback table keyed by substrings matched against the strategy label
// (case-insensitive). Checked in order - first match wins. These are
// rough archetypes: momentum/breakout strategies tend to resolve fast,
// trend-following strategies are slower, mean-reversion/pullback sits
// in between.
const STRATEGY_TYPE_FALLBACK = [
    { match: /breakout/i, minutes: 5 },
    { match: /momentum/i, minutes: 5 },
    { match: /scalp/i, minutes: 1 },
    { match: /pullback|fib/i, minutes: 15 },
    { match: /mean reversion|range/i, minutes: 15 },
    { match: /trend/i, minutes: 60 },
    { match: /swing/i, minutes: 240 }
];

function bucketFor(minutes) {
    for (const bucket of EXPIRY_BUCKETS) {
        if (minutes <= bucket.minutes) return bucket;
    }
    return EXPIRY_BUCKETS[EXPIRY_BUCKETS.length - 1];
}

/**
 * @param {object} signal - a signal object as returned by signalEngine.js
 *   (needs signal.risk.{stopDistance,rewardMultiple,atr} for the
 *   data-driven path, and signal.strategy for the fallback path).
 * @param {string} timeframe - the candle timeframe being scanned, e.g. "1m".
 * @returns {{ label: string, minutes: number, method: "data" | "fallback" }}
 */
export function estimateExpiry(signal, timeframe = "1m") {
    const tfMinutes = TIMEFRAME_MINUTES[timeframe] ?? 1;
    const risk = signal?.risk;

    if (risk && Number.isFinite(risk.atr) && risk.atr > 0 && Number.isFinite(risk.stopDistance)) {
        // Total distance to the full target (TP2), in price terms.
        const targetDistance = risk.stopDistance * (risk.rewardMultiple ?? 1);
        // ATR is "typical movement per candle" - dividing gives a rough
        // candle count for price to cover that distance at its current pace.
        const candlesToTarget = targetDistance / risk.atr;
        const minutes = Math.max(tfMinutes, candlesToTarget * tfMinutes);
        return { ...bucketFor(minutes), method: "data" };
    }

    // Fallback: match strategy label to an archetype.
    const label = signal?.strategy ?? "";
    const fallback = STRATEGY_TYPE_FALLBACK.find(f => f.match.test(label));
    const minutes = fallback?.minutes ?? 15; // generic default if nothing matches
    return { ...bucketFor(minutes), method: "fallback" };
}
