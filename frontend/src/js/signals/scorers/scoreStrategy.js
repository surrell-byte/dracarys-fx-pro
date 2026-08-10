import { getQuality } from "./shared.js";
import { STRATEGIES } from "@signals/strategyRegistry.js";

export function scoreStrategy(context) {
    const {
        strategy,
        ema20,
        ema50,
        rsi,
        macd,
        bb,
        adx,
        atrPercent,
        volumeRatio,
        levels,
        fib,
        pattern,
        price
    } = context;
    const weights = strategy.weights;
    let buyScore = 0;
    let sellScore = 0;
    let penalty = 0;
    const reasons = [];
    const confirmations = [];

    // Kept in sync with the live copy in signalEngine.js - see the
    // comment there for why trend-cluster votes (EMA/MACD/RSI-trend/ADX)
    // are discounted once one of them has already voted a side. This
    // file is currently unused by the app; flagged separately.
    const CORR_DISCOUNT = 0.5;
    let trendClusterSide = null;

    if (ema20 && ema50) {
        if (ema20 > ema50) {
            buyScore += weights.trend;
            reasons.push("EMA trend up");
            trendClusterSide = "buy";
        } else {
            sellScore += weights.trend;
            reasons.push("EMA trend down");
            trendClusterSide = "sell";
        }
    }

    if (macd) {
        const macdSide = macd.MACD > macd.signal ? "buy" : "sell";
        const macdWeight = trendClusterSide === macdSide
            ? weights.momentum * CORR_DISCOUNT
            : weights.momentum;
        if (macdSide === "buy") {
            buyScore += macdWeight;
            reasons.push("MACD bullish");
        } else {
            sellScore += macdWeight;
            reasons.push("MACD bearish");
        }
        if (!trendClusterSide) trendClusterSide = macdSide;
    }

    if (rsi <= 35) {
        buyScore += weights.rsi;
        reasons.push("RSI oversold");
    } else if (rsi >= 65) {
        sellScore += weights.rsi;
        reasons.push("RSI overbought");
    } else if (strategy === STRATEGIES.trend && rsi > 50) {
        const rsiWeight = trendClusterSide === "buy" ? (weights.rsi / 2) * CORR_DISCOUNT : weights.rsi / 2;
        buyScore += rsiWeight;
        if (!trendClusterSide) trendClusterSide = "buy";
    } else if (strategy === STRATEGIES.trend && rsi < 50) {
        const rsiWeight = trendClusterSide === "sell" ? (weights.rsi / 2) * CORR_DISCOUNT : weights.rsi / 2;
        sellScore += rsiWeight;
        if (!trendClusterSide) trendClusterSide = "sell";
    }

    if (bb) {
        if (strategy === STRATEGIES.breakout) {
            if (price >= bb.upper) {
                buyScore += weights.bands;
                reasons.push("Upper band breakout");
            } else if (price <= bb.lower) {
                sellScore += weights.bands;
                reasons.push("Lower band breakdown");
            }
        } else {
            if (price <= bb.lower) {
                buyScore += weights.bands;
                reasons.push("Below lower band");
            } else if (price >= bb.upper) {
                sellScore += weights.bands;
                reasons.push("Above upper band");
            }
        }
    }

    if (fib && strategy === STRATEGIES.pullback && ema20 && ema50) {
        const uptrend = ema20 > ema50;
        const downtrend = ema20 < ema50;
        const nearR50 = Math.abs(price - fib.r50) / price <= 0.003;
        const nearR618 = Math.abs(price - fib.r618) / price <= 0.003;

        if (uptrend && (nearR50 || nearR618)) {
            buyScore += weights.levels;
            reasons.push(nearR618 ? "Pullback to 61.8% fib" : "Pullback to 50% fib");
        } else if (downtrend && (nearR50 || nearR618)) {
            sellScore += weights.levels;
            reasons.push(nearR618 ? "Rally to 61.8% fib" : "Rally to 50% fib");
        }
    }

    if (strategy === STRATEGIES.range && adx?.adx < 20) {
        reasons.push("Ranging market");
    }

    if (pattern === "bullish") {
        buyScore += weights.pattern;
        reasons.push("Bullish candle pattern");
    } else if (pattern === "bearish") {
        sellScore += weights.pattern;
        reasons.push("Bearish candle pattern");
    }

    if (levels.support && price <= levels.support * 1.003) {
        const side = strategy === STRATEGIES.breakout ? "sell" : "buy";
        if (side === "buy") buyScore += weights.levels;
        else sellScore += weights.levels;
        reasons.push(strategy === STRATEGIES.breakout ? "Support breakdown area" : "Near support");
    }

    if (levels.resistance && price >= levels.resistance * 0.997) {
        const side = strategy === STRATEGIES.breakout ? "buy" : "sell";
        if (side === "buy") buyScore += weights.levels;
        else sellScore += weights.levels;
        reasons.push(strategy === STRATEGIES.breakout ? "Resistance breakout area" : "Near resistance");
    }

    if (adx?.adx > 25 && weights.adxBoost !== 0) {
        const adxBoost = trendClusterSide ? weights.adxBoost * CORR_DISCOUNT : weights.adxBoost;
        if (buyScore > sellScore) buyScore += adxBoost;
        if (sellScore > buyScore) sellScore += adxBoost;
        confirmations.push("strong trend");
    }

    if (Number.isFinite(volumeRatio)) {
        if (volumeRatio >= 1.15) {
            if (buyScore > sellScore) buyScore += 6;
            if (sellScore > buyScore) sellScore += 6;
            confirmations.push("volume confirmed");
        } else if (volumeRatio < 0.75) {
            penalty += 10;
            reasons.push("Low volume");
        }
    }

    if (Number.isFinite(atrPercent)) {
        if (atrPercent < 0.08) {
            penalty += strategy === STRATEGIES.scalping ? 4 : 12;
            reasons.push("Low volatility");
        } else if (atrPercent > 2.5) {
            penalty += 10;
            reasons.push("High volatility risk");
        } else {
            confirmations.push("tradable volatility");
        }
    }

    const agreement = Math.abs(buyScore - sellScore);
    if (agreement < 12) {
        penalty += 12;
        reasons.push("Mixed signal agreement");
    }

    const quality = getQuality({
        adx: adx?.adx,
        atrPercent,
        volumeRatio,
        agreement,
        penalty
    });

    if (confirmations.length) {
        reasons.push(confirmations[0]);
    }

    return {
        buyScore: Math.max(0, buyScore),
        sellScore: Math.max(0, sellScore),
        penalty,
        quality,
        reasons
    };
}
