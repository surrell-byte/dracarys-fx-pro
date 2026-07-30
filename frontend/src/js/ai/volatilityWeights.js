// Volatility-adaptive weighting for the AI Confidence Pipeline. Different
// module types are reliable in different volatility regimes — mean-reversion
// tools (Bollinger, Stochastic, Doji, Support/Resistance) tend to work in
// quiet/ranging markets and whipsaw in fast ones; trend/momentum/breakout
// tools (EMA, ADX, MACD, Marubozu, Break of Structure) tend to do the
// opposite. This reweights each module's vote before it reaches
// ai/confidence.js, rather than changing what any module itself reports.
//
// Scoping note: this is volatility-adaptive (driven by ATR%, which the
// engine already computes for every asset), not literally crypto-only —
// the engine doesn't track asset class, so there's nothing to gate on
// besides the volatility regime itself. Crypto is the asset class that
// swings hardest between "dead quiet" and "violent trend" most often,
// which is why it's the motivating case, but the same logic applies
// identically to forex or anything else feeding this pipeline.
//
// Normal volatility intentionally applies NO adjustment (all weights = 1),
// so the common case behaves exactly as it did before this module existed.

import { volatilityRegime } from "@marketRegime/marketRegime.js";

// Re-exported for backward compatibility - anything that was importing
// volatilityRegime from this file specifically still gets the same function,
// it's just canonically defined in marketRegime.js now (previously this file
// and analysis/strategyTester.js each kept their own identical copy).
export { volatilityRegime };

const NEUTRAL_WEIGHTS = {
    ema: 1, rsi: 1, macd: 1, adx: 1, bollinger: 1, stochastic: 1,
    engulfing: 1, hammerStar: 1, doji: 1, tweezers: 1, marubozu: 1, star: 1,
    supportResistance: 1, breakOfStructure: 1, changeOfCharacter: 1, trendline: 1
};

// Quiet/ranging market: mean-reversion and level-based reads get more say,
// breakout/trend-continuation reads get less (more likely to be fakeouts).
const LOW_VOL_WEIGHTS = {
    ema: 0.7, rsi: 1.3, macd: 0.8, adx: 0.6, bollinger: 1.4, stochastic: 1.3,
    engulfing: 1.0, hammerStar: 1.1, doji: 1.2, tweezers: 1.2, marubozu: 0.7, star: 1.1,
    supportResistance: 1.3, breakOfStructure: 0.6, changeOfCharacter: 1.0, trendline: 1.2
};

// Fast/expansion market: trend, momentum, and continuation reads get more
// say, mean-reversion reads get less (overbought/oversold gets run over).
const HIGH_VOL_WEIGHTS = {
    ema: 1.3, rsi: 0.7, macd: 1.2, adx: 1.4, bollinger: 0.6, stochastic: 0.6,
    engulfing: 1.1, hammerStar: 0.9, doji: 0.6, tweezers: 0.7, marubozu: 1.3, star: 0.9,
    supportResistance: 0.7, breakOfStructure: 1.4, changeOfCharacter: 1.1, trendline: 0.7
};

export function getVolatilityWeights(atrPercent) {
    const regime = volatilityRegime(atrPercent);
    const weights = regime === "Low Vol" ? LOW_VOL_WEIGHTS
        : regime === "High Vol" ? HIGH_VOL_WEIGHTS
        : NEUTRAL_WEIGHTS;

    return { regime, weights };
}

