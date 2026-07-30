import { findSwingPoints } from "./marketStructure.js";

// HEURISTIC, NOT REAL LIQUIDITY DATA. Genuine liquidity zones are where
// stop-loss and pending orders actually cluster in the order book - that
// requires order-book or open-interest data this app has no legitimate
// source for from spot candles alone (same reason a real "liquidity.js"
// was flagged rather than built earlier).
//
// What this module actually does is a much weaker proxy: it groups nearby
// swing highs/lows into clusters, on the theory that a price level tested
// several times is more likely to have real stops parked just beyond it.
// That's a reasonable trading heuristic - but it is NOT the same claim as
// "this is where the liquidity actually is", so every vote here carries an
// explicit "(heuristic)" tag in its reason and a structurally reduced
// weight (see WEIGHT below) so it can never outvote the modules that are
// checking real, falsifiable shapes (candlestick patterns, trendline fit
// quality, etc.) by looking more confident than it has any right to be.
const CLUSTER_TOLERANCE_PERCENT = 0.3; // swing points within this % of each other count as one cluster
const MIN_CLUSTER_SIZE = 2;
const MAX_CONFIDENCE = 50; // capped well below the rigorous modules on purpose
const PROXIMITY_THRESHOLD_PERCENT = 1.5; // how close price must get to a cluster to vote at all
const WEIGHT = 0.5; // structural discount applied regardless of volatility regime

function clusterPoints(points, tolerancePercent) {
    if (!points.length) return [];
    const sorted = [...points].sort((a, b) => a.price - b.price);
    const clusters = [];
    let current = [sorted[0]];

    for (let i = 1; i < sorted.length; i += 1) {
        const point = sorted[i];
        const clusterAvg = current.reduce((s, p) => s + p.price, 0) / current.length;
        const tolerance = clusterAvg * (tolerancePercent / 100);
        if (Math.abs(point.price - clusterAvg) <= tolerance) {
            current.push(point);
        } else {
            clusters.push(current);
            current = [point];
        }
    }
    clusters.push(current);

    return clusters
        .filter(cluster => cluster.length >= MIN_CLUSTER_SIZE)
        .map(cluster => ({
            price: cluster.reduce((s, p) => s + p.price, 0) / cluster.length,
            touches: cluster.length
        }));
}

// Returns the same { signal, confidence, reason, value, weight } contract
// as every other module - the extra `weight` field is read by
// ai/confidence.js as a per-vote fallback when the current volatility
// regime doesn't specify one, which is how this stays discounted in every
// regime rather than just some of them.
export function analyzeLiquidityZones(candles, lookback = 80) {
    const recent = candles.slice(-lookback);
    if (recent.length < 20) {
        return {
            signal: "WAIT", confidence: 0,
            reason: "Not enough candles for liquidity-cluster heuristic",
            value: {}, weight: WEIGHT
        };
    }

    const { highs, lows } = findSwingPoints(recent);
    const price = candles.at(-1).close;

    const resistanceClusters = clusterPoints(highs.map(h => ({ price: h.price })), CLUSTER_TOLERANCE_PERCENT);
    const supportClusters = clusterPoints(lows.map(l => ({ price: l.price })), CLUSTER_TOLERANCE_PERCENT);

    if (!resistanceClusters.length && !supportClusters.length) {
        return {
            signal: "WAIT", confidence: 0,
            reason: "No repeated-touch zones found (heuristic, not real liquidity data)",
            value: {}, weight: WEIGHT
        };
    }

    const nearestAbove = resistanceClusters
        .filter(c => c.price > price)
        .sort((a, b) => a.price - b.price)[0];
    const nearestBelow = supportClusters
        .filter(c => c.price < price)
        .sort((a, b) => b.price - a.price)[0];

    const candidates = [];

    if (nearestAbove) {
        const distancePercent = ((nearestAbove.price - price) / price) * 100;
        if (distancePercent <= PROXIMITY_THRESHOLD_PERCENT) {
            // Soft "stop hunt" read: price approaching a likely stop-cluster
            // zone above often sweeps through it before reversing down. This
            // is a well-known retail heuristic, not a verified mechanism -
            // hence the low confidence ceiling.
            candidates.push({
                signal: "SELL",
                confidence: Math.round(Math.min(MAX_CONFIDENCE, 20 + nearestAbove.touches * 5)),
                reason: `Approaching likely stop-cluster zone above (${nearestAbove.touches} touches, heuristic)`
            });
        }
    }

    if (nearestBelow) {
        const distancePercent = ((price - nearestBelow.price) / price) * 100;
        if (distancePercent <= PROXIMITY_THRESHOLD_PERCENT) {
            candidates.push({
                signal: "BUY",
                confidence: Math.round(Math.min(MAX_CONFIDENCE, 20 + nearestBelow.touches * 5)),
                reason: `Approaching likely stop-cluster zone below (${nearestBelow.touches} touches, heuristic)`
            });
        }
    }

    if (!candidates.length) {
        return {
            signal: "WAIT",
            confidence: 10,
            reason: "Stop-cluster zones identified (heuristic), price not near either",
            value: { resistanceClusters, supportClusters },
            weight: WEIGHT
        };
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return { ...candidates[0], value: { resistanceClusters, supportClusters }, weight: WEIGHT };
}
