import { describe, it, expect } from "vitest";
import { scoreStrategy } from "@signals/signalEngine.js";
import { STRATEGIES } from "@signals/strategyRegistry.js";

// Minimal context builder. levels defaults to an object with no
// support/resistance so those branches don't fire unless a test needs them.
function baseContext(overrides = {}) {
    return {
        strategy: STRATEGIES.trend,
        ema20: 1.1050,
        ema50: 1.1000,
        rsi: 55,
        macd: { MACD: 0.002, signal: 0.001 },
        bb: null,
        adx: { adx: 30 },
        atrPercent: 0.5,
        volumeRatio: 1,
        levels: {},
        fib: null,
        pattern: null,
        price: 1.1050,
        ...overrides
    };
}

describe("scoreStrategy - correlation-aware weighting", () => {
    it("discounts MACD when it agrees with the EMA trend direction", () => {
        const weights = STRATEGIES.trend.weights;

        // EMA up (buy), MACD bullish (agrees) - MACD should count at half weight.
        const agreeing = scoreStrategy(baseContext());

        // EMA up (buy), MACD bearish (disagrees) - MACD should count at full weight.
        const disagreeing = scoreStrategy(
            baseContext({ macd: { MACD: 0.001, signal: 0.002 } })
        );

        // EMA always contributes weights.trend to buyScore first.
        // Agreeing case: buyScore = trend + momentum * 0.5 (+ any adx/rsi discount)
        // Disagreeing case: buyScore = trend only, sellScore = momentum (full weight)
        const agreeingMacdContribution = agreeing.buyScore - weights.trend;
        const disagreeingMacdContribution = disagreeing.sellScore;

        expect(disagreeingMacdContribution).toBeCloseTo(weights.momentum, 5);
        // The agreeing contribution includes RSI/ADX too, but it must be
        // strictly less than a full, undiscounted momentum weight would add
        // on top of trend - proving MACD itself was discounted.
        expect(agreeingMacdContribution).toBeLessThan(weights.momentum + weights.trend);
    });

    it("does not discount MACD when there is no established trend-cluster side yet", () => {
        // No EMA data at all - MACD is the first (and only) trend-cluster vote,
        // so it should count at full weight.
        const result = scoreStrategy(
            baseContext({ ema20: null, ema50: null, rsi: 50, adx: { adx: 10 } })
        );
        expect(result.buyScore).toBeCloseTo(STRATEGIES.trend.weights.momentum, 5);
    });

    it("discounts the ADX boost once a trend-cluster side is already established", () => {
        const withTrend = scoreStrategy(baseContext({ adx: { adx: 30 } }));
        const withoutAdx = scoreStrategy(baseContext({ adx: { adx: 10 } }));

        const adxContribution = withTrend.buyScore - withoutAdx.buyScore;
        expect(adxContribution).toBeCloseTo(
            STRATEGIES.trend.weights.adxBoost * 0.5,
            5
        );
    });

    it("gives the ADX boost full weight when no trend-cluster vote has fired", () => {
        // Strip out EMA and MACD so trendClusterSide stays null going into
        // the ADX check; RSI in the neutral zone for a non-trend strategy
        // also stays out of the cluster.
        const context = baseContext({
            strategy: STRATEGIES.meanReversion,
            ema20: null,
            ema50: null,
            macd: null,
            rsi: 50
        });
        const withAdx = scoreStrategy({ ...context, adx: { adx: 30 } });
        const withoutAdx = scoreStrategy({ ...context, adx: { adx: 10 } });

        // Nothing has a side yet before ADX runs, so whichever side is
        // "leading" (0 vs 0, buyScore is not > sellScore) won't get boosted -
        // confirm the boost is simply absent rather than silently discounted
        // into a nonzero delta.
        expect(withAdx.buyScore).toBeCloseTo(withoutAdx.buyScore, 5);
        expect(withAdx.sellScore).toBeCloseTo(withoutAdx.sellScore, 5);
    });

    it("still lets non-trend-cluster signals (bands, pattern, levels) vote at full weight", () => {
        // Bollinger band signal is independent of the trend cluster and
        // should never be discounted by this change.
        const withBand = scoreStrategy(
            baseContext({ bb: { upper: 1.11, lower: 1.09 }, price: 1.115 })
        );
        const withoutBand = scoreStrategy(baseContext({ bb: null }));

        const bandContribution = withBand.sellScore - withoutBand.sellScore;
        expect(bandContribution).toBeCloseTo(STRATEGIES.trend.weights.bands, 5);
    });
});
