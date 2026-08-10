import {
    calculateADX,
    calculateATR,
    calculateBB,
    calculateEMA,
    calculateFibLevels,
    calculateMACD,
    calculateParabolicSAR,
    calculateROC,
    calculateRSI,
    calculateVolumeRatio,
    getSupportResistance
} from "@indicators/indicators.js";
import { detectPattern } from "@patterns/patterns.js";
import { analyzeEma } from "@indicators/ema.js";
import { analyzeRsi } from "@indicators/rsi.js";
import { analyzeMacd } from "@indicators/macd.js";
import { analyzeAdx } from "@indicators/adx.js";
import { analyzeBollinger } from "@indicators/bollinger.js";
import { analyzeStochastic } from "@indicators/stochastic.js";
import { combineConfidence } from "@ai/confidence.js";
import { toProbabilities } from "@ai/probabilityEngine.js";
import { getVolatilityWeights } from "@ai/volatilityWeights.js";
import { getRegimeWeights } from "@ai/regimeWeights.js";
import { getRegimeRiskFactors } from "@risk/regimeStops.js";
import { estimateExpiry } from "@risk/expiryEstimate.js";
import { analyzeEngulfing } from "@patterns/engulfing.js";
import { analyzeHammerShootingStar } from "@patterns/hammer.js";
import { analyzeDoji } from "@patterns/doji.js";
import { analyzeTweezers } from "@patterns/tweezers.js";
import { analyzeMarubozu } from "@patterns/marubozu.js";
import { analyzeStar } from "@patterns/star.js";
import {
    analyzeSupportResistance,
    analyzeBreakOfStructure,
    analyzeChangeOfCharacter
} from "@analysis/marketStructure.js";
import { analyzeTrendline } from "@analysis/trendlines.js";
import { analyzeLiquidityZones } from "@analysis/liquidity.js";
import { analyzeChartPatterns } from "@chartPatterns/chartPatterns.js";
import { classifyMarketRegime } from "@marketRegime/marketRegime.js";
import { analyzeOrderBlocks } from "@smartMoney/orderBlocks.js";
import { analyzeFairValueGaps } from "@smartMoney/fairValueGap.js";
import { analyzeLiquiditySweep } from "@smartMoney/liquiditySweep.js";
import { analyzeBreakerBlocks } from "@smartMoney/breaker.js";
import { analyzeMitigation } from "@smartMoney/mitigation.js";

// Module 7/8 defaults (ATR stop-loss multiplier + reward:risk multiple).
// Any strategy without its own values falls back to these.
const DEFAULT_ATR_STOP_MULTIPLIER = 1.8;
const DEFAULT_REWARD_MULTIPLE = 2.5;

export const STRATEGIES = {
    balanced: {
        label: "Balanced",
        threshold: 55,
        weights: {
            trend: 20,
            momentum: 20,
            rsi: 20,
            bands: 15,
            pattern: 15,
            levels: 10,
            adxBoost: 10
        }
    },
    trend: {
        label: "Trend Follow",
        threshold: 60,
        weights: {
            trend: 35,
            momentum: 30,
            rsi: 8,
            bands: 5,
            pattern: 8,
            levels: 4,
            adxBoost: 15
        }
    },
    meanReversion: {
        label: "Mean Reversion",
        threshold: 58,
        weights: {
            trend: 6,
            momentum: 8,
            rsi: 35,
            bands: 28,
            pattern: 12,
            levels: 16,
            adxBoost: -8
        }
    },
    breakout: {
        label: "Breakout",
        threshold: 62,
        weights: {
            trend: 22,
            momentum: 24,
            rsi: 6,
            bands: 18,
            pattern: 8,
            levels: 25,
            adxBoost: 16
        }
    },
    scalping: {
        label: "Scalping",
        threshold: 52,
        weights: {
            trend: 12,
            momentum: 24,
            rsi: 24,
            bands: 16,
            pattern: 18,
            levels: 8,
            adxBoost: 5
        }
    },
    pullback: {
        label: "Pullback (Fib)",
        threshold: 58,
        weights: {
            trend: 28,
            momentum: 16,
            rsi: 10,
            bands: 6,
            pattern: 14,
            levels: 22,
            adxBoost: 12
        }
    },
    momentum: {
        label: "Momentum",
        threshold: 60,
        weights: {
            trend: 18,
            momentum: 32,
            rsi: 4,
            bands: 6,
            pattern: 10,
            levels: 6,
            adxBoost: 18
        }
    },
    range: {
        label: "Range Trading",
        threshold: 56,
        weights: {
            trend: 4,
            momentum: 6,
            rsi: 30,
            bands: 30,
            pattern: 14,
            levels: 18,
            adxBoost: -16
        }
    },
    ema165SarRoc: {
        label: "EMA165 SAR ROC21",
        threshold: 68,
        custom: "ema165SarRoc",
        weights: {
            trend: 0,
            momentum: 0,
            rsi: 0,
            bands: 0,
            pattern: 0,
            levels: 0,
            adxBoost: 0
        }
    },
    // "Trend-Following" duplicates the existing "Trend Follow" id/name above,
    // so this one is differentiated as "Trend Following 2".
    trendFollowing2: {
        label: "Trend Following 2 (EMA 50/200)",
        threshold: 62,
        custom: "trendFollowing2",
        useHigherTimeframe: true,
        atrStopMultiplier: 2.0,
        rewardMultiple: 2.5,
        weights: {
            trend: 0,
            momentum: 0,
            rsi: 0,
            bands: 0,
            pattern: 0,
            levels: 0,
            adxBoost: 0
        }
    },
    // "Breakout + Volume Confirmation" duplicates the existing "Breakout" id/name above,
    // so this one is differentiated as "Breakout 2".
    breakout2: {
        label: "Breakout 2 (Volume Confirmed)",
        threshold: 60,
        custom: "breakout2",
        atrStopMultiplier: 1.5,
        rewardMultiple: 2.0,
        weights: {
            trend: 0,
            momentum: 0,
            rsi: 0,
            bands: 0,
            pattern: 0,
            levels: 0,
            adxBoost: 0
        }
    },
    // "Mean Reversion with RSI" duplicates the existing "Mean Reversion" id/name above,
    // so this one is differentiated as "Mean Reversion 2".
    meanReversion2: {
        label: "Mean Reversion 2 (RSI Range)",
        threshold: 55,
        custom: "meanReversion2",
        weights: {
            trend: 0,
            momentum: 0,
            rsi: 0,
            bands: 0,
            pattern: 0,
            levels: 0,
            adxBoost: 0
        }
    },
    // "EMA Pullback + ADX Trend Filter" is conceptually close to the existing
    // "Pullback (Fib)" strategy, so this one is named to make the distinction
    // clear: EMA20/50 trend with a strict ADX gate and a single-candle
    // wick-below/close-above EMA20 confirmation trigger (not a fib retracement).
    emaPullbackAdx: {
        label: "EMA Pullback (ADX Filter)",
        threshold: 65,
        custom: "emaPullbackAdx",
        useHigherTimeframe: true,
        atrStopMultiplier: 1.5,
        rewardMultiple: 2.5,
        weights: {
            trend: 0,
            momentum: 0,
            rsi: 0,
            bands: 0,
            pattern: 0,
            levels: 0,
            adxBoost: 0
        }
    },
    // Milestone 1: the new module pipeline. Every indicator votes
    // independently as { signal, confidence, reason }; ai/confidence.js
    // combines the votes instead of hand-tuned point addition. This sits
    // alongside every strategy above rather than replacing any of them —
    // pick it from the dropdown like any other strategy to compare it
    // against the hand-tuned ones on the same market.
    aiConfidence: {
        label: "AI Confidence Pipeline",
        threshold: 50,
        custom: "aiConfidence",
        weights: {
            trend: 0,
            momentum: 0,
            rsi: 0,
            bands: 0,
            pattern: 0,
            levels: 0,
            adxBoost: 0
        }
    }
};

export function generateSignal(candles, strategyId = "balanced", context = {}) {
    const strategy = STRATEGIES[strategyId] ?? STRATEGIES.balanced;
    const higherTrend = context?.higherTrend ?? "NEUTRAL";

    const requiredCandles = strategy.custom === "ema165SarRoc" ? 180
        : strategy.custom === "trendFollowing2" ? 220
        : strategy.custom === "breakout2" ? 60
        : strategy.custom === "meanReversion2" ? 40
        : 55;

    if (!Array.isArray(candles) || candles.length < requiredCandles) {
        return {
            type: "HOLD",
            signal: "HOLD",
            confidence: 0,
            strength: 0,
            probabilities: { buyProbability: 0, sellProbability: 0, waitProbability: 1 },
            reason: `Collecting candles (${candles?.length ?? 0}/${requiredCandles})`,
            strategy: strategy.label,
            ready: false
        };
    }

    const closes = candles.map(candle => candle.close);
    const highs = candles.map(candle => candle.high);
    const lows = candles.map(candle => candle.low);
    const volumes = candles.map(candle => candle.volume);
    const latest = candles.at(-1);
    const previous = candles.at(-2);
    const price = latest.close;

    const ema20 = calculateEMA(closes, 20).at(-1);
    const ema50 = calculateEMA(closes, 50).at(-1);
    const ema165 = calculateEMA(closes, 165).at(-1);
    const ema200 = calculateEMA(closes, 200).at(-1);
    const rsi = calculateRSI(closes).at(-1) ?? 50;
    const macd = calculateMACD(closes).at(-1);
    const psar = calculateParabolicSAR(highs, lows, 0.02, 0.2).at(-1);
    const roc21 = calculateROC(closes, 21).at(-1);
    const bb = calculateBB(closes).at(-1);
    const adx = calculateADX(highs, lows, closes).at(-1);
    const atr = calculateATR(highs, lows, closes).at(-1);
    const atrPercent = atr ? (atr / price) * 100 : null;
    // Computed once, here, so it can gate the AI Confidence Pipeline below
    // instead of only being computed at the end for display - see
    // scoreAiConfidencePipeline and ai/regimeWeights.js.
    const regime = classifyMarketRegime(candles, { adx: adx?.adx ?? null, atrPercent });
    const volumeRatio = calculateVolumeRatio(volumes);
    const levels = getSupportResistance(candles);
    const fib = calculateFibLevels(candles);
    const pattern = detectPattern(previous, latest);

    const scored = strategy.custom === "ema165SarRoc"
        ? scoreEmaSarRocStrategy({
            adx,
            atrPercent,
            ema165,
            price,
            psar,
            roc21,
            volumeRatio
        })
        : strategy.custom === "trendFollowing2"
        ? scoreTrendFollowing2({
            adx,
            atrPercent,
            ema20,
            ema50,
            ema200,
            price,
            volumeRatio
        })
        : strategy.custom === "breakout2"
        ? scoreBreakout2({
            adx,
            atrPercent,
            candles,
            price,
            volumeRatio
        })
        : strategy.custom === "meanReversion2"
        ? scoreMeanReversion2({
            adx,
            atrPercent,
            levels,
            price,
            rsi,
            volumeRatio
        })
        : strategy.custom === "emaPullbackAdx"
        ? scoreEmaPullbackAdx({
            adx,
            atrPercent,
            candles,
            ema20,
            ema50,
            volumeRatio
        })
        : strategy.custom === "aiConfidence"
        ? scoreAiConfidencePipeline({
            candles,
            highs,
            lows,
            closes,
            atrPercent,
            volumeRatio,
            regime,
            // Ablation hook: pass e.g. { excludeVoteModules: ["orderBlock",
            // "fairValueGap", ...] } via generateSignal's `context` to test
            // whether a given voting module actually adds predictive value
            // (see the original review's "SMC modules should be treated as
            // hypotheses, not facts" note, and
            // scripts/analysis/smcAblationTest.js). Defaults to including
            // everything, so normal callers are unaffected.
            excludeVoteModules: context?.excludeVoteModules ?? []
        })
        : scoreStrategy({
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
    });

    // Module 2 (Higher Timeframe Trend): strategies that opt in only trade
    // with the daily bias — longs disabled against a daily downtrend, shorts
    // disabled against a daily uptrend. NEUTRAL/unavailable HTF data is a no-op
    // so a slow or failed daily fetch never blocks trading outright.
    if (strategy.useHigherTimeframe && higherTrend !== "NEUTRAL") {
        if (higherTrend === "UP" && scored.sellScore > 0) {
            scored.sellScore = 0;
            scored.reasons.unshift("Blocked: daily trend is up, shorts disabled");
        }
        if (higherTrend === "DOWN" && scored.buyScore > 0) {
            scored.buyScore = 0;
            scored.reasons.unshift("Blocked: daily trend is down, longs disabled");
        }
    }

    const rawConfidence = Math.max(scored.buyScore, scored.sellScore);
    const confidence = Math.min(100, Math.max(0, Math.round(rawConfidence - scored.penalty)));
    const probabilities = toProbabilities({ confidence, buyScore: scored.buyScore, sellScore: scored.sellScore });
    const type = confidence >= strategy.threshold
        ? (scored.buyScore > scored.sellScore ? "BUY" : "SELL")
        : "HOLD";

    // Module 7/8: ATR-based stop-loss and R-multiple take-profit, used both to
    // display risk levels and to size positions (risk% / stop distance).
    //
    // Milestone: Forex-mode style output. TP1 is a nearer partial target at
    // 1:1 reward-to-risk (the common "move stop to breakeven" level once hit);
    // TP2 is the existing full reward-multiple target. TP1 is display-only
    // here — it doesn't trigger any partial position close, that would need
    // real position-splitting logic this app doesn't have yet.
    let risk = null;
    if (type !== "HOLD" && Number.isFinite(atr) && atr > 0) {
        const baseStopMultiplier = strategy.atrStopMultiplier ?? DEFAULT_ATR_STOP_MULTIPLIER;
        const baseRewardMultiple = strategy.rewardMultiple ?? DEFAULT_REWARD_MULTIPLE;
        // risk/regimeStops.js: widen/tighten the strategy's own stop and
        // reward target based on the same regime already gating the AI
        // Confidence Pipeline's module weights above - a multiplicative
        // adjustment on top of whatever the strategy already specifies,
        // not a replacement for it.
        const regimeRisk = getRegimeRiskFactors(regime.primary);
        const stopMultiplier = baseStopMultiplier * regimeRisk.stopMultiplier;
        const rewardMultiple = baseRewardMultiple * regimeRisk.rewardMultiplier;
        const stopDistance = atr * stopMultiplier;
        const stopLoss = type === "BUY" ? price - stopDistance : price + stopDistance;
        const takeProfit = type === "BUY"
            ? price + stopDistance * rewardMultiple
            : price - stopDistance * rewardMultiple;

        // TP1 sits at 1:1 RR, capped so it can never sit beyond TP2 for
        // strategies with a reward multiple at or below 1.
        const tp1Multiple = Math.min(1, rewardMultiple);
        const takeProfit1 = type === "BUY"
            ? price + stopDistance * tp1Multiple
            : price - stopDistance * tp1Multiple;

        risk = {
            atr,
            stopDistance,
            entry: price,
            stopLoss,
            takeProfit,
            takeProfit1,
            takeProfit2: takeProfit,
            stopMultiplier,
            rewardMultiple,
            // Pre-regime-adjustment values, so the UI (or a future risk
            // review screen) can show "1.8x -> 2.34x (Trending)" instead of
            // just the final number with no explanation of where it came from.
            baseStopMultiplier,
            baseRewardMultiple,
            regimeRiskFactors: regimeRisk,
            rewardToRisk1: tp1Multiple,
            rewardToRisk2: rewardMultiple,
            rrLabel: `1:${tp1Multiple.toFixed(1)} / 1:${rewardMultiple.toFixed(1)}`
        };
    }

    return {
        type,
        signal: type,
        confidence,
        strength: confidence / 100,
        price,
        support: levels.support,
        resistance: levels.resistance,
        strategy: strategy.label,
        risk,
        indicators: {
            adx: adx?.adx ?? null,
            ema20: ema20 ?? null,
            ema50: ema50 ?? null,
            ema165: ema165 ?? null,
            ema200: ema200 ?? null,
            macd: macd?.histogram ?? null,
            psar: psar ?? null,
            roc21: roc21 ?? null,
            atr: atr ?? null,
            atrPercent,
            volumeRatio,
            rsi,
            pattern,
            higherTrend: strategy.useHigherTimeframe ? higherTrend : null
        },
        quality: scored.quality,
        expiry: type !== "HOLD" ? estimateExpiry({ risk, strategy: strategy.label }, "1m") : null,
        reason: scored.reasons.slice(0, 3).join(", ") || "No clear edge",
        moduleBreakdown: scored.breakdown ?? null,
        volRegime: scored.volRegime ?? null,
        probabilities,
        // No longer purely informational for the AI Confidence Pipeline - see
        // scoreAiConfidencePipeline, which now uses this same regime object to
        // gate module weighting. For every other strategy this remains what
        // it always was: exposed so any caller (UI, backtest, a future
        // decision engine) can query "what kind of market is this" without
        // recomputing it themselves.
        regime,
        ready: true
    };
}

function scoreEmaSarRocStrategy({ adx, atrPercent, ema165, price, psar, roc21, volumeRatio }) {
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

// Rules: use 50 EMA vs 200 EMA for trend direction, only enter on pullbacks
// into the 20/50 EMA zone, and require ADX to confirm the trend is real.
function scoreTrendFollowing2({ adx, atrPercent, ema20, ema50, ema200, price, volumeRatio }) {
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

// Rules: mark a prior range, require price to close beyond it (not just
// wick through), and only trust the breakout if volume is >= 1.5x average.
function scoreBreakout2({ adx, atrPercent, candles, price, volumeRatio }) {
    const reasons = [];
    const lookback = 50;
    // Exclude the current/latest candle so we're comparing the close against
    // a range that was established *before* this bar, not including it.
    const priorCandles = candles.slice(-lookback - 1, -1);

    if (!priorCandles.length) {
        return {
            buyScore: 0,
            sellScore: 0,
            penalty: 40,
            quality: "Low",
            reasons: ["Not enough range history"]
        };
    }

    let buyScore = 0;
    let sellScore = 0;
    let penalty = 0;

    const rangeHigh = Math.max(...priorCandles.map(c => c.high));
    const rangeLow = Math.min(...priorCandles.map(c => c.low));
    const brokeAbove = price > rangeHigh;
    const brokeBelow = price < rangeLow;
    const volumeConfirmed = Number.isFinite(volumeRatio) && volumeRatio >= 1.5;

    if (brokeAbove) {
        buyScore += 50;
        reasons.push("Close above prior range resistance");
        if (volumeConfirmed) {
            buyScore += 30;
            reasons.push("Volume >= 1.5x average");
        } else {
            penalty += 20;
            reasons.push("Breakout lacks volume confirmation");
        }
    } else if (brokeBelow) {
        sellScore += 50;
        reasons.push("Close below prior range support");
        if (volumeConfirmed) {
            sellScore += 30;
            reasons.push("Volume >= 1.5x average");
        } else {
            penalty += 20;
            reasons.push("Breakdown lacks volume confirmation");
        }
    } else {
        penalty += 15;
        reasons.push("Price inside range, no breakout");
    }

    if (adx?.adx >= 22) {
        if (buyScore > sellScore) buyScore += 10;
        if (sellScore > buyScore) sellScore += 10;
    }

    if (Number.isFinite(atrPercent) && atrPercent > 3) {
        penalty += 10;
        reasons.push("Volatility extended, breakout risk elevated");
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

// Rules: only favor reversion when ADX shows a range-bound market, buy RSI
// oversold near support, sell RSI overbought near resistance.
function scoreMeanReversion2({ adx, atrPercent, levels, price, rsi, volumeRatio }) {
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

// Rules: EMA20 vs EMA50 sets trend direction, ADX must be > 25 to confirm
// it's a real trend (not chop), and entry requires a single confirmation
// candle that wicks through EMA20 but closes back on the trend side of it —
// mirrors the Pine Script bullConfirm/bearConfirm logic exactly.
function scoreEmaPullbackAdx({ adx, atrPercent, candles, ema20, ema50, volumeRatio }) {
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

// Milestone 1 pipeline: each indicator module votes independently, then
// ai/confidence.js combines the votes. This function's only job is
// translating that combined result into the buyScore/sellScore shape the
// rest of generateSignal already expects — it deliberately does NOT
// re-implement any scoring logic itself, so the combiner stays the single
// source of truth for how votes get weighed.
function scoreAiConfidencePipeline({ candles, highs, lows, closes, atrPercent, volumeRatio, regime, excludeVoteModules = [] }) {
    const excluded = new Set(excludeVoteModules);
    const votes = [
        { name: "ema", ...analyzeEma(closes) },
        { name: "rsi", ...analyzeRsi(closes) },
        { name: "macd", ...analyzeMacd(closes) },
        { name: "adx", ...analyzeAdx(highs, lows, closes) },
        { name: "bollinger", ...analyzeBollinger(closes) },
        { name: "stochastic", ...analyzeStochastic(highs, lows, closes) },
        // Milestone 2: candlestick pattern modules.
        { name: "engulfing", ...analyzeEngulfing(candles) },
        { name: "hammerStar", ...analyzeHammerShootingStar(candles) },
        { name: "doji", ...analyzeDoji(candles) },
        { name: "tweezers", ...analyzeTweezers(candles) },
        { name: "marubozu", ...analyzeMarubozu(candles) },
        { name: "star", ...analyzeStar(candles) },
        // Milestone 2: market structure modules.
        { name: "supportResistance", ...analyzeSupportResistance(candles) },
        { name: "breakOfStructure", ...analyzeBreakOfStructure(candles) },
        { name: "changeOfCharacter", ...analyzeChangeOfCharacter(candles) },
        { name: "trendline", ...analyzeTrendline(candles) },
        // Milestone: liquidity heuristic. Structurally down-weighted (see
        // liquidity.js WEIGHT constant) since it's a proxy, not real
        // order-book data - it should never be able to outvote the
        // rigorous pattern/trendline/indicator modules above.
        { name: "liquidityZone", ...analyzeLiquidityZones(candles) },
        // Milestone: chart pattern geometry (double top/bottom, head &
        // shoulders, triangles, wedges, channels, flags). Same structural
        // discount as liquidityZone above, for the same reason — see
        // chartPatterns.js's WEIGHT comment.
        { name: "chartPattern", ...analyzeChartPatterns(candles) },
        // Milestone: Smart Money modules (order blocks, fair value gaps,
        // liquidity sweeps, breaker blocks, mitigation decay). Same
        // structural discount pattern as liquidityZone/chartPattern above
        // - see each module's own header for why (heuristic vs objective).
        { name: "orderBlock", ...analyzeOrderBlocks(candles) },
        { name: "fairValueGap", ...analyzeFairValueGaps(candles) },
        { name: "liquiditySweep", ...analyzeLiquiditySweep(candles) },
        { name: "breakerBlock", ...analyzeBreakerBlocks(candles) },
        { name: "mitigation", ...analyzeMitigation(candles) }
    ].filter((vote) => !excluded.has(vote.name));

    // Milestone 4: volatility-adaptive weighting. Reweights each module's
    // vote based on the current ATR% regime before combining, rather than
    // changing what any module itself reports.
    const { regime: volRegime, weights: volWeights } = getVolatilityWeights(atrPercent);

    // Milestone 5: market-regime gating. A second, orthogonal reweighting
    // pass based on classifyMarketRegime()'s trend/breakout read (see
    // ai/regimeWeights.js's header for why this is a separate axis from
    // volatility rather than folded into it).
    const { weights: regimeWeights } = getRegimeWeights(regime?.primary);

    // Multiply the two axes together per module. Only the modules both
    // tables have always covered (the 16 "core" indicator/candlestick/
    // structure modules) get touched here - liquidity/chart-pattern/smart-
    // money modules are deliberately left out of this object so their own
    // structural down-weight (each module's own `weight` field) keeps
    // applying via combineConfidence's `weights[name] ?? vote.weight ?? 1`
    // fallback, instead of being silently overwritten with a flat 1.
    const combinedWeights = {};
    for (const name of Object.keys(volWeights)) {
        combinedWeights[name] = volWeights[name] * (regimeWeights[name] ?? 1);
    }

    const combined = combineConfidence(votes, combinedWeights);
    const quality = combined.participation >= 70 ? "High" : combined.participation >= 40 ? "Medium" : "Low";

    return {
        buyScore: combined.signal === "BUY" ? combined.confidence : 0,
        sellScore: combined.signal === "SELL" ? combined.confidence : 0,
        penalty: 0,
        volRegime,
        trendRegime: regime?.primary ?? null,
        quality,
        reasons: combined.reasons.length ? combined.reasons : ["No module reached a confident opinion"],
        breakdown: combined.breakdown
    };
}

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

    // EMA trend, MACD, the RSI trend-continuation vote, and the ADX boost
    // all measure the same underlying thing (is the market trending, and
    // which way). Left unweighted, a single trending market gets counted
    // as four independent "votes" for the same side, which overstates
    // confidence. trendClusterSide tracks the side this cluster has
    // already voted for; later cluster members that merely restate it
    // are discounted rather than dropped, since they still carry some
    // marginal information (e.g. confirming the trend hasn't stalled).
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
        // ADX confirms trend strength for whichever side is already
        // leading - it's part of the same trend cluster as EMA/MACD/RSI,
        // so discount it too when that cluster has already voted.
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

function getQuality({ adx, atrPercent, volumeRatio, agreement, penalty }) {
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

