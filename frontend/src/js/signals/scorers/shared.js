// shared.js - scoring helper reused by every custom strategy scorer.
// Extracted as part of the signalEngine.js decomposition (Phase 6
// architecture cleanup); moved verbatim, no logic changes.

export function getQuality({ adx, atrPercent, volumeRatio, agreement, penalty }) {
    let score = 0;

    if (adx >= 20) score += 25;
    if (adx >= 30) score += 10;
    if (atrPercent >= 0.08 && atrPercent <= 2.5) score += 25;
    if (volumeRatio >= 1) score += 20;
    if (agreement >= 18) score += 20;
    score -= penalty;

    if (score >= 70) return "High";
    if (score >= 45) return "Medium";
    return "Low";
}
