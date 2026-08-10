// strategyRegistry.js
//
// Pure strategy configuration - thresholds, per-factor weights, and any
// per-strategy overrides (custom scorer id, ATR stop multiplier, reward
// multiple, higher-timeframe filter flag). No scoring logic lives here;
// signalEngine.js reads this table and dispatches to scoreStrategy() or
// one of the custom scorer functions based on each entry's `custom` field.
//
// Extracted out of signalEngine.js (which was ~1,140 lines handling
// strategy definitions, scoring, and orchestration all in one file) as
// part of the Phase 6 architecture cleanup - this part of the split was
// pure data with zero logic, so it carries effectively zero behavioral
// risk. The scoring functions and generateSignal() orchestration remain
// in signalEngine.js for now; see that file's header for the current
// state of the rest of the split.

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
