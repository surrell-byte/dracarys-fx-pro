// Single source of truth for "what kind of market is this right now". Before
// this module existed, trend/volatility regime classification was
// duplicated in two places with identical thresholds and labels —
// analysis/strategyTester.js (for its regime breakdown table) and
// ai/volatilityWeights.js (for reweighting the AI confidence pipeline).
// Both now import from here instead of each keeping their own copy.
//
// classifyMarketRegime() is the new piece: a single-word bucket
// (TRENDING / RANGING / BREAKOUT / HIGH_VOLATILITY) plus an advisory
// `recommendedFor` tag list, so a strategy (or a future decision engine)
// can cheaply ask "should I even be active right now" instead of everyone
// re-deriving trend/vol state independently.

const ADX_TRENDING_THRESHOLD = 25;
const ADX_RANGING_THRESHOLD = 18;
const LOW_VOL_THRESHOLD = 0.08;
const HIGH_VOL_THRESHOLD = 2.5;
const BREAKOUT_LOOKBACK = 20; // candles of prior range used to judge a breakout, excludes the current candle
const BREAKOUT_MIN_BUFFER_PERCENT = 0.15; // floor on the buffer even when ATR% is tiny - a near-zero ATR shouldn't mean any new local extreme counts as a "breakout"
const BREAKOUT_ATR_MULTIPLE = 1.0; // breakout must clear the recent range by at least 1x ATR%, not just tick over it

export function trendRegime(adx) {
    if (!Number.isFinite(adx)) return "Unknown";
    if (adx >= ADX_TRENDING_THRESHOLD) return "Trending";
    if (adx < ADX_RANGING_THRESHOLD) return "Ranging";
    return "Transitional";
}

export function volatilityRegime(atrPercent) {
    if (!Number.isFinite(atrPercent)) return "Unknown";
    if (atrPercent < LOW_VOL_THRESHOLD) return "Low Vol";
    if (atrPercent > HIGH_VOL_THRESHOLD) return "High Vol";
    return "Normal Vol";
}

export function regimeLabel(indicators) {
    return `${trendRegime(indicators?.adx)} / ${volatilityRegime(indicators?.atrPercent)}`;
}

// A real range-expansion check, not a fabricated flag: did the current
// candle's close clear the high/low of the preceding BREAKOUT_LOOKBACK
// candles (which do NOT include the current candle) by more than one ATR%?
// Using ATR as the buffer means the bar to call something a "breakout"
// scales with how volatile the asset already is, instead of a fixed
// percentage that would be too loose on a calm pair and too strict on a
// wild one.
export function detectBreakout(candles, atrPercent) {
    if (!Array.isArray(candles) || candles.length < BREAKOUT_LOOKBACK + 2) {
        return { breakout: false, direction: null, priorHigh: null, priorLow: null };
    }

    const priorCandles = candles.slice(-(BREAKOUT_LOOKBACK + 1), -1);
    const current = candles.at(-1);
    const priorHigh = Math.max(...priorCandles.map(c => c.high));
    const priorLow = Math.min(...priorCandles.map(c => c.low));

    const bufferPercent = Number.isFinite(atrPercent) && atrPercent > 0
        ? Math.max(atrPercent * BREAKOUT_ATR_MULTIPLE, BREAKOUT_MIN_BUFFER_PERCENT)
        : BREAKOUT_MIN_BUFFER_PERCENT;

    const upperThreshold = priorHigh * (1 + bufferPercent / 100);
    const lowerThreshold = priorLow * (1 - bufferPercent / 100);

    if (current.close > upperThreshold) return { breakout: true, direction: "UP", priorHigh, priorLow };
    if (current.close < lowerThreshold) return { breakout: true, direction: "DOWN", priorHigh, priorLow };
    return { breakout: false, direction: null, priorHigh, priorLow };
}

// The main query API. `indicators` only needs { adx, atrPercent } - both
// already computed by generateSignal() for every strategy, so callers
// don't need to recompute anything to use this.
//
// Priority order: a genuine range-expansion breakout is the most specific,
// actionable read, so it wins even against a high-vol backdrop. Sustained
// high volatility with no fresh breakout is its own (more cautious) regime
// rather than being folded into "Trending", since a choppy, wide-swinging
// market isn't necessarily a tradeable trend even when ADX is elevated.
// Everything else falls back to the plain trend/range read.
export function classifyMarketRegime(candles, indicators = {}) {
    const { adx, atrPercent } = indicators;
    const trend = trendRegime(adx);
    const volatility = volatilityRegime(atrPercent);
    const breakout = detectBreakout(candles, atrPercent);

    let primary;
    if (breakout.breakout) primary = "BREAKOUT";
    else if (volatility === "High Vol") primary = "HIGH_VOLATILITY";
    else if (trend === "Trending") primary = "TRENDING";
    else primary = "RANGING";

    // Advisory only - nothing in the engine currently gates on this. It's
    // here so a future decision engine (or a strategy that wants to opt in)
    // has somewhere to ask the question, without every module having to
    // invent its own answer.
    const recommendedFor = {
        TRENDING: ["trend", "momentum", "breakout"],
        BREAKOUT: ["breakout", "momentum"],
        RANGING: ["meanReversion", "range", "supportResistance"],
        HIGH_VOLATILITY: [] // be selective / widen risk management rather than favor one style
    }[primary];

    return {
        primary,
        trend,
        volatility,
        label: `${trend} / ${volatility}`,
        breakout,
        recommendedFor
    };
}

