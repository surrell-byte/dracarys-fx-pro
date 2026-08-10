import { getQuality } from "./shared.js";

// Rules: EMA20 vs EMA50 sets trend direction, ADX must be > 25 to confirm
// it's a real trend (not chop), and entry requires a single confirmation
// candle that wicks through EMA20 but closes back on the trend side of it —
// mirrors the Pine Script bullConfirm/bearConfirm logic exactly.
export function scoreEmaPullbackAdx({ adx, atrPercent, candles, ema20, ema50, volumeRatio }) {
    if (!Number.isFinite(ema20) || !Number.isFinite(ema50)) {
        return {
            buyScore: 0,
            sellScore: 0,
            penalty: 30,
            quality: "Low",
            reasons: ["EMAs not ready"]
        };
    }

    let buyScore = 0;
    let sellScore = 0;
    let penalty = 0;
    const reasons = [];
    const latest = candles.at(-1);

    const longTrend = ema20 > ema50;
    const shortTrend = ema20 < ema50;
    const strongTrend = Number.isFinite(adx?.adx) && adx.adx > 25;

    const bullConfirm = latest.close > ema20 && latest.low < ema20 && latest.close > latest.open;
    const bearConfirm = latest.close < ema20 && latest.high > ema20 && latest.close < latest.open;

    if (longTrend) reasons.push("EMA20 above EMA50 (uptrend)");
    if (shortTrend) reasons.push("EMA20 below EMA50 (downtrend)");

    if (strongTrend) {
        reasons.push("ADX above 25");
    } else {
        penalty += 25;
        reasons.push("ADX below 25, trend too weak");
    }

    if (longTrend && strongTrend && bullConfirm) {
        buyScore += 75;
        reasons.push("Pullback to EMA20, bullish confirmation candle");
    }

    if (shortTrend && strongTrend && bearConfirm) {
        sellScore += 75;
        reasons.push("Pullback to EMA20, bearish confirmation candle");
    }

    if (!buyScore && !sellScore) {
        penalty += 20;
        reasons.push("No valid pullback/confirmation setup yet");
    }

    if (Number.isFinite(volumeRatio) && volumeRatio >= 1) {
        if (buyScore > sellScore) buyScore += 10;
        if (sellScore > buyScore) sellScore += 10;
        reasons.push("Volume supportive");
    }

    if (Number.isFinite(atrPercent) && atrPercent < 0.08) {
        penalty += 8;
        reasons.push("Low volatility, weak follow-through risk");
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
