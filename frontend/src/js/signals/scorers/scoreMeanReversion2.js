import { getQuality } from "./shared.js";

// Rules: only favor reversion when ADX shows a range-bound market, buy RSI
// oversold near support, sell RSI overbought near resistance.
export function scoreMeanReversion2({ adx, atrPercent, levels, price, rsi, volumeRatio }) {
    let buyScore = 0;
    let sellScore = 0;
    let penalty = 0;
    const reasons = [];

    const isRanging = !Number.isFinite(adx?.adx) || adx.adx < 22;
    if (!isRanging) {
        penalty += 20;
        reasons.push("Market trending, mean reversion unfavorable");
    }

    const nearSupport = levels.support && price <= levels.support * 1.005;
    const nearResistance = levels.resistance && price >= levels.resistance * 0.995;

    if (rsi < 30 && nearSupport) {
        buyScore += 60;
        reasons.push("RSI oversold near support");
    } else if (rsi < 30) {
        buyScore += 25;
        reasons.push("RSI oversold");
    }

    if (rsi > 70 && nearResistance) {
        sellScore += 60;
        reasons.push("RSI overbought near resistance");
    } else if (rsi > 70) {
        sellScore += 25;
        reasons.push("RSI overbought");
    }

    if (isRanging) {
        if (buyScore > sellScore) buyScore += 10;
        if (sellScore > buyScore) sellScore += 10;
    }

    const agreement = Math.abs(buyScore - sellScore);
    if (agreement < 15) {
        penalty += 10;
        reasons.push("No clear reversion setup");
    }

    return {
        buyScore: Math.max(0, buyScore),
        sellScore: Math.max(0, sellScore),
        penalty,
        quality: getQuality({ adx: adx?.adx, atrPercent, volumeRatio, agreement, penalty }),
        reasons
    };
}
