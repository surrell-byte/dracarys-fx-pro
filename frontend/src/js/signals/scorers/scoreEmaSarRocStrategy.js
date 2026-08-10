import { getQuality } from "./shared.js";

// scoreEmaSarRocStrategy - EMA165/PSAR/ROC21 strategy scorer.
// Extracted verbatim from signalEngine.js as part of the Phase 6
// architecture cleanup - no logic changes.

export function scoreEmaSarRocStrategy({ adx, atrPercent, ema165, price, psar, roc21, volumeRatio }) {
    let buyScore = 0;
    let sellScore = 0;
    let penalty = 0;
    const reasons = [];

    if (Number.isFinite(ema165)) {
        if (price > ema165) {
            buyScore += 35;
            reasons.push("Price above EMA165");
        } else {
            sellScore += 35;
            reasons.push("Price below EMA165");
        }
    }

    if (Number.isFinite(psar)) {
        if (price > psar) {
            buyScore += 30;
            reasons.push("PSAR bullish");
        } else {
            sellScore += 30;
            reasons.push("PSAR bearish");
        }
    }

    if (Number.isFinite(roc21)) {
        if (roc21 > 0.05) {
            buyScore += 25;
            reasons.push("ROC21 positive");
        } else if (roc21 < -0.05) {
            sellScore += 25;
            reasons.push("ROC21 negative");
        } else {
            penalty += 10;
            reasons.push("ROC21 flat");
        }
    }

    if (adx?.adx >= 18) {
        if (buyScore > sellScore) buyScore += 6;
        if (sellScore > buyScore) sellScore += 6;
    } else {
        penalty += 8;
        reasons.push("Weak trend");
    }

    if (Number.isFinite(volumeRatio) && volumeRatio < 0.75) {
        penalty += 8;
        reasons.push("Low volume");
    }

    if (Number.isFinite(atrPercent) && atrPercent < 0.08) {
        penalty += 8;
        reasons.push("Low volatility");
    }

    const agreement = Math.abs(buyScore - sellScore);
    if (agreement < 20) {
        penalty += 15;
        reasons.push("EMA/SAR/ROC not aligned");
    }

    return {
        buyScore: Math.max(0, buyScore),
        sellScore: Math.max(0, sellScore),
        penalty,
        quality: getQuality({
            adx: adx?.adx,
            atrPercent,
            volumeRatio,
            agreement,
            penalty
        }),
        reasons
    };
}
