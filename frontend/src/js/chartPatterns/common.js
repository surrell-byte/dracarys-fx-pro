// Shared helpers for the chartPatterns/ modules. Every detector here builds
// on top of marketStructure.js's findSwingPoints() rather than re-deriving
// pivots itself - a triangle, wedge, channel, double top, and head &
// shoulders are all just different claims about the same underlying swing
// highs/lows, so the pivot-finding logic should only exist in one place.
//
// linearRegression() here is intentionally a separate, small copy of the
// same math trendlines.js uses internally (trendlines.js keeps its fit
// helpers private, and its touch/quality thresholds are tuned specifically
// for "is this a genuine diagonal trendline", not for "do these two
// boundaries converge/diverge/run parallel" - the question every pattern
// in this folder is actually asking).

export function linearRegression(points) {
    const n = points.length;
    if (n < 2) return null;

    const sumX = points.reduce((s, p) => s + p.index, 0);
    const sumY = points.reduce((s, p) => s + p.price, 0);
    const meanX = sumX / n;
    const meanY = sumY / n;

    let num = 0;
    let den = 0;
    for (const p of points) {
        num += (p.index - meanX) * (p.price - meanY);
        den += (p.index - meanX) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;

    let ssTot = 0;
    let ssRes = 0;
    for (const p of points) {
        const predicted = slope * p.index + intercept;
        ssRes += (p.price - predicted) ** 2;
        ssTot += (p.price - meanY) ** 2;
    }
    const rSquared = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;

    return { slope, intercept, rSquared };
}

export function slopePercentPerCandle(slope, avgPrice) {
    return avgPrice > 0 ? (slope / avgPrice) * 100 : 0;
}

// How tightly a set of points hugs its fitted line, as a max-deviation
// percentage of average price. Deliberately NOT R² for this purpose: R² is
// (residual variance / total variance), and for a genuinely flat boundary
// (an ascending triangle's flat top, a horizontal channel side) the total
// variance is already close to zero, which makes R² numerically unstable
// even when the flat fit is excellent in absolute terms. A direct residual
// check has no such degenerate case — it means the same thing whether the
// line is flat, rising, or falling.
export function maxResidualPercent(points, fit, avgPrice) {
    if (!fit || avgPrice <= 0) return Infinity;
    let maxPercent = 0;
    for (const p of points) {
        const predicted = fit.slope * p.index + fit.intercept;
        const residualPercent = (Math.abs(p.price - predicted) / avgPrice) * 100;
        if (residualPercent > maxPercent) maxPercent = residualPercent;
    }
    return maxPercent;
}

export function pricesRoughlyEqual(a, b, tolerancePercent) {
    const avg = (a + b) / 2;
    if (avg <= 0) return false;
    return (Math.abs(a - b) / avg) * 100 <= tolerancePercent;
}

// Every detector returns this shape when the pattern isn't present, so
// callers never have to special-case a missing `value`/`reason`.
export function empty(pattern, value = {}) {
    return { detected: false, confidence: 0, direction: null, pattern, reason: "Pattern not present", value };
}

