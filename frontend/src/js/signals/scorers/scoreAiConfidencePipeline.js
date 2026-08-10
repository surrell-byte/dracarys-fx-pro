import { analyzeEma } from "@indicators/ema.js";
import { analyzeRsi } from "@indicators/rsi.js";
import { analyzeMacd } from "@indicators/macd.js";
import { analyzeAdx } from "@indicators/adx.js";
import { analyzeBollinger } from "@indicators/bollinger.js";
import { analyzeStochastic } from "@indicators/stochastic.js";
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
import { analyzeOrderBlocks } from "@smartMoney/orderBlocks.js";
import { analyzeFairValueGaps } from "@smartMoney/fairValueGap.js";
import { analyzeLiquiditySweep } from "@smartMoney/liquiditySweep.js";
import { analyzeBreakerBlocks } from "@smartMoney/breaker.js";
import { analyzeMitigation } from "@smartMoney/mitigation.js";
import { combineConfidence } from "@ai/confidence.js";
import { getVolatilityWeights } from "@ai/volatilityWeights.js";
import { getRegimeWeights } from "@ai/regimeWeights.js";

// Milestone 1 pipeline: each indicator module votes independently, then
// ai/confidence.js combines the votes. This function's only job is
// translating that combined result into the buyScore/sellScore shape the
// rest of generateSignal already expects — it deliberately does NOT
// re-implement any scoring logic itself, so the combiner stays the single
// source of truth for how votes get weighed.
export function scoreAiConfidencePipeline({ candles, highs, lows, closes, atrPercent, volumeRatio, regime, excludeVoteModules = [] }) {
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
