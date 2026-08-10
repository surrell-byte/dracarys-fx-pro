import { getQuality } from "./shared.js";

// Rules: use 50 EMA vs 200 EMA for trend direction, only enter on pullbacks
// into the 20/50 EMA zone, and require ADX to confirm the trend is real.
export function scoreTrendFollowing2({ adx, atrPercent, ema20, ema50, ema200, price, volumeRatio }) {
    let buyScore = 0;
    let sellScore = 0;
    let penalty = 0;
    const reasons = [];

    if (!Number.isFinite(ema200) || !Number.isFinite(ema50) || !Number.isFinite(ema20)) {
        penalty += 25;
        reasons.push("EMAs not ready");
    } else if (ema50 > ema200) {
        reasons.push("50 EMA above 200 EMA (uptrend)");
        const pullbackFloor = Math.min(ema20, ema50) * 0.995;
        const pullbackCeiling = Math.max(ema20, ema50) * 1.005;
        const inPullbackZone = price >= pullbackFloor && price <= pullbackCeiling;

        if (inPullbackZone) {
            buyScore += 55;
            reasons.push("Pullback into 20/50 EMA zone");
        } else if (price > pullbackCeiling) {
            buyScore += 20;
            reasons.push("Trend intact, extended above EMAs");
        } else {
            penalty += 10;
            reasons.push("Price broke below EMA zone");
        }
    } else if (ema50 < ema200) {
        reasons.push("50 EMA below 200 EMA (downtrend)");
        const rallyFloor = Math.min(ema20, ema50) * 0.995;
        const rallyCeiling = Math.max(ema20, ema50) * 1.005;
        const inRallyZone = price >= rallyFloor && price <= rallyCeiling;

        if (inRallyZone) {
            sellScore += 55;
            reasons.push("Rally into 20/50 EMA zone");
        } else if (price < rallyFloor) {
            sellScore += 20;
            reasons.push("Trend intact, extended below EMAs");
        } else {
            penalty += 10;
            reasons.push("Price broke above EMA zone");
        }
    }

    if (adx?.adx >= 20) {
        if (buyScore > sellScore) buyScore += 15;
        if (sellScore > buyScore) sellScore += 15;
        reasons.push("Trend strength confirmed (ADX)");
    } else {
        penalty += 12;
        reasons.push("Weak ADX, trend unconfirmed");
    }

    if (Number.isFinite(volumeRatio) && volumeRatio < 0.8) {
        penalty += 6;
        reasons.push("Below-average volume");
    }

    if (Number.isFinite(atrPercent) && atrPercent < 0.08) {
        penalty += 8;
        reasons.push("Low volatility");
    }

    const agreement = Math.abs(buyScore - sellScore);

    return {
        buyScore: Math.max(0, buyScore),
        sellScore: Math.max(0, sellScore),
        penalty,
        quality: getQuality({ adx: adx?.adx, atrPercent, volumeRatio, agreement, penalty }),
        reasons
    };
}
