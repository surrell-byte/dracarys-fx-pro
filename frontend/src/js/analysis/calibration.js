// frontend/src/js/analysis/calibration.js
//
// Stage 7: confidence calibration.
//
// Signals carry a raw `confidence` (0-100) heuristic score - nothing has
// checked whether "70% confidence" trades actually win ~70% of the time.
// This measures that empirically from closed trades (backtestEngine.js's
// spotTrades, which now carry `confidence` and `outcome` per trade).
//
// This does NOT feed back into live/paper decisions - it only measures
// calibration and exposes a lookup for inspection.

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Buckets raw predictions (each { confidence, outcome }) into fixed-width
 * confidence ranges and tallies wins/losses per bucket.
 */
export function createConfidenceBuckets(predictions, bucketSize = 5) {
    const buckets = new Map();

    for (const prediction of predictions ?? []) {
        if (!prediction) continue;

        const confidence = Number(prediction.confidence);
        if (!Number.isFinite(confidence)) continue;

        const bucketStart = Math.floor(clamp(confidence, 0, 100) / bucketSize) * bucketSize;

        if (!buckets.has(bucketStart)) {
            buckets.set(bucketStart, {
                bucketStart,
                bucketEnd: bucketStart + bucketSize,
                predictions: 0,
                wins: 0,
                losses: 0
            });
        }

        const bucket = buckets.get(bucketStart);
        bucket.predictions += 1;
        if (prediction.outcome === "win") bucket.wins += 1;
        else if (prediction.outcome === "loss") bucket.losses += 1;
    }

    return [...buckets.values()]
        .sort((a, b) => a.bucketStart - b.bucketStart)
        .map((bucket) => ({
            ...bucket,
            actualWinRate:
                bucket.wins + bucket.losses > 0
                    ? (bucket.wins / (bucket.wins + bucket.losses)) * 100
                    : null,
            predictedMidpoint: (bucket.bucketStart + bucket.bucketEnd) / 2
        }));
}

/**
 * Weighted-average absolute gap between predicted confidence midpoint and
 * observed win rate, across buckets that have data.
 */
export function computeCalibrationError(buckets) {
    const usable = (buckets ?? []).filter(
        (bucket) => bucket.actualWinRate != null && bucket.predictions > 0
    );

    if (!usable.length) return null;

    const total = usable.reduce((sum, bucket) => sum + bucket.predictions, 0);

    return usable.reduce((sum, bucket) => {
        const weight = bucket.predictions / total;
        return sum + Math.abs(bucket.predictedMidpoint - bucket.actualWinRate) * weight;
    }, 0);
}

/**
 * Builds an empirical calibration lookup from a set of closed predictions.
 *
 * options.minObservations: a bucket needs at least this many closed trades
 * before it's trusted for lookup (default 30) - guards against reading a
 * "calibrated" number off a couple of lucky trades in a sparse bucket.
 */
export function buildEmpiricalCalibration(predictions, options = {}) {
    const { bucketSize = 5, minObservations = 30 } = options;

    const buckets = createConfidenceBuckets(predictions, bucketSize);
    const usableBuckets = buckets.filter(
        (bucket) => bucket.wins + bucket.losses >= minObservations
    );

    return {
        buckets,
        usableBuckets,
        calibrationError: computeCalibrationError(usableBuckets),

        calibratedConfidence(rawConfidence) {
            const confidence = clamp(Number(rawConfidence), 0, 100);
            const bucket = usableBuckets.find(
                (candidate) => confidence >= candidate.bucketStart && confidence < candidate.bucketEnd
            );

            if (!bucket || bucket.actualWinRate == null) return null;
            return bucket.actualWinRate;
        }
    };
}

/**
 * Convenience: pulls { confidence, outcome } predictions straight out of
 * backtestEngine.js's spotTrades array, dropping trades without a
 * usable confidence.
 */
export function extractPredictionsFromTrades(trades) {
    return (trades ?? [])
        .filter((trade) => trade && Number.isFinite(trade.confidence))
        .map((trade) => ({
            confidence: trade.confidence,
            outcome: trade.outcome
        }));
}
