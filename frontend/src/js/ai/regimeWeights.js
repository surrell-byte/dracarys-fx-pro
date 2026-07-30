// Trend-regime-adaptive weighting for the AI Confidence Pipeline. This is
// deliberately a SEPARATE axis from ai/volatilityWeights.js, not a
// replacement for it:
//   - volatilityWeights.js reweights by ATR% (quiet vs. violent price action)
//   - regimeWeights.js (here) reweights by ADX trend strength + the
//     range-expansion breakout flag (grinding trend vs. chop vs. fresh
//     breakout) - classifyMarketRegime()'s trend/breakout read, independent
//     of how big the candles happen to be right now
// The two axes are genuinely orthogonal: a market can be low-ADX/low-ATR
// (dead chop), high-ADX/low-ATR (a slow grinding trend), or high-ADX/high-ATR
// (a violent trend) and each of those wants a different mix of modules.
// signalEngine.js multiplies both tables together per module rather than
// picking one.
//
// TRENDING / RANGING / BREAKOUT here mirror classifyMarketRegime()'s
// `recommendedFor` tags (trend/momentum/breakout vs. meanReversion/range/
// supportResistance) - trend-following and momentum modules get more say
// while trending or breaking out, mean-reversion and level/reversal-pattern
// modules get more say while ranging.
//
// HIGH_VOLATILITY intentionally applies NO adjustment here (see NEUTRAL_WEIGHTS
// below). classifyMarketRegime() only reports HIGH_VOLATILITY when ATR% is
// already elevated with no fresh breakout - the exact condition
// volatilityWeights.js's HIGH_VOL_WEIGHTS table already reweights for.
// Stacking a second adjustment on the same underlying condition would
// double-count one signal rather than add new information, so this table
// stays flat and lets the volatility axis be the only one that moves.

const NEUTRAL_WEIGHTS = {
    ema: 1, rsi: 1, macd: 1, adx: 1, bollinger: 1, stochastic: 1,
    engulfing: 1, hammerStar: 1, doji: 1, tweezers: 1, marubozu: 1, star: 1,
    supportResistance: 1, breakOfStructure: 1, changeOfCharacter: 1, trendline: 1
};

// Grinding/established trend (high ADX, no fresh breakout): trend and
// momentum reads get more say; counter-trend reversal candles (doji,
// tweezers, star) get less - in a real trend they're more often a pause
// than a reversal, and the mean-reversion tools (RSI/Bollinger/Stochastic/
// Support-Resistance) get less since "overbought/oversold" is a weaker read
// against a strong trend.
const TRENDING_WEIGHTS = {
    ema: 1.3, rsi: 0.85, macd: 1.25, adx: 1.35, bollinger: 0.75, stochastic: 0.75,
    engulfing: 1.05, hammerStar: 0.85, doji: 0.7, tweezers: 0.75, marubozu: 1.2, star: 0.8,
    supportResistance: 0.85, breakOfStructure: 1.25, changeOfCharacter: 1.0, trendline: 1.2
};

// Ranging (low ADX, no breakout): mirror image of TRENDING_WEIGHTS -
// mean-reversion and level-based reads get more say, trend/continuation
// reads get less (more likely to be the fakeouts that get faded back into
// the range).
const RANGING_WEIGHTS = {
    ema: 0.7, rsi: 1.3, macd: 0.75, adx: 0.6, bollinger: 1.35, stochastic: 1.3,
    engulfing: 1.0, hammerStar: 1.15, doji: 1.2, tweezers: 1.15, marubozu: 0.75, star: 1.1,
    supportResistance: 1.35, breakOfStructure: 0.65, changeOfCharacter: 0.9, trendline: 0.8
};

// Fresh range-expansion breakout: continuation/structure-break reads get
// the strongest boost of any regime (this is specifically what they're
// built to catch), reversal candlestick patterns get cut hardest - a
// single-candle "reversal" print right at a breakout is disproportionately
// likely to be noise, not an actual turn.
const BREAKOUT_WEIGHTS = {
    ema: 1.15, rsi: 0.7, macd: 1.2, adx: 1.15, bollinger: 1.0, stochastic: 0.7,
    engulfing: 1.1, hammerStar: 0.75, doji: 0.55, tweezers: 0.65, marubozu: 1.3, star: 0.7,
    supportResistance: 0.9, breakOfStructure: 1.35, changeOfCharacter: 1.2, trendline: 0.95
};

export function getRegimeWeights(primary) {
    const weights = primary === "TRENDING" ? TRENDING_WEIGHTS
        : primary === "RANGING" ? RANGING_WEIGHTS
        : primary === "BREAKOUT" ? BREAKOUT_WEIGHTS
        : NEUTRAL_WEIGHTS; // HIGH_VOLATILITY and anything unrecognized

    return { primary: primary ?? "UNKNOWN", weights };
}
