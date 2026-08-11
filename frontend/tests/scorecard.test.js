import { describe, expect, it } from "vitest";
import {
    buildStrategyScorecard,
    buildRegimeScorecard,
    buildAssetScorecard
} from "@analysis/scorecard.js";

const ROWS = [
    { symbol: "BTC/USDT", regime: "TREND", strategy: "aiConfidence", trades: 10, winRate: 60, expectancy: 0.5, profitFactor: 1.4, sharpe: 0.9 },
    { symbol: "BTC/USDT", regime: "RANGE", strategy: "aiConfidence", trades: 8, winRate: 40, expectancy: -0.2, profitFactor: 0.8, sharpe: -0.3 },
    { symbol: "ETH/USDT", regime: "TREND", strategy: "aiConfidence", trades: 12, winRate: 55, expectancy: 0.3, profitFactor: 1.2, sharpe: 0.6 },
    { symbol: "BTC/USDT", regime: "TREND", strategy: "trendFollow", trades: 20, winRate: 50, expectancy: 0.1, profitFactor: 1.05, sharpe: 0.2 }
];

describe("buildStrategyScorecard", () => {
    it("groups rows by strategy and computes averages", () => {
        const scorecard = buildStrategyScorecard(ROWS);
        const aiConfidence = scorecard.find((r) => r.strategy === "aiConfidence");
        expect(aiConfidence.samples).toBe(3);
        expect(aiConfidence.totalTrades).toBe(30);
        expect(aiConfidence.avgExpectancy).toBeCloseTo((0.5 - 0.2 + 0.3) / 3, 5);
        const trendFollow = scorecard.find((r) => r.strategy === "trendFollow");
        expect(trendFollow.samples).toBe(1);
    });

    it("sorts by avg expectancy, best first", () => {
        const scorecard = buildStrategyScorecard(ROWS);
        expect(scorecard[0].strategy).toBe("aiConfidence");
    });

    it("computes expectancy consistency as % of profitable folds", () => {
        const scorecard = buildStrategyScorecard(ROWS);
        const aiConfidence = scorecard.find((r) => r.strategy === "aiConfidence");
        expect(aiConfidence.expectancyConsistency).toBeCloseTo((2 / 3) * 100, 5);
        expect(aiConfidence.profitableFolds).toBe(2);
    });

    it("handles empty input without throwing", () => {
        expect(buildStrategyScorecard([])).toEqual([]);
    });

    it("ignores null/undefined rows", () => {
        const scorecard = buildStrategyScorecard([...ROWS, null, undefined]);
        expect(scorecard.reduce((sum, r) => sum + r.samples, 0)).toBe(ROWS.length);
    });
});

describe("buildRegimeScorecard", () => {
    it("groups rows by regime", () => {
        const scorecard = buildRegimeScorecard(ROWS);
        const trend = scorecard.find((r) => r.regime === "TREND");
        const range = scorecard.find((r) => r.regime === "RANGE");
        expect(trend.samples).toBe(3);
        expect(range.samples).toBe(1);
    });

    it("falls back to UNKNOWN when regime is missing", () => {
        const scorecard = buildRegimeScorecard([{ strategy: "x", expectancy: 0.1 }]);
        expect(scorecard[0].regime).toBe("UNKNOWN");
    });
});

describe("buildAssetScorecard", () => {
    it("groups rows by symbol", () => {
        const scorecard = buildAssetScorecard(ROWS);
        const btc = scorecard.find((r) => r.symbol === "BTC/USDT");
        const eth = scorecard.find((r) => r.symbol === "ETH/USDT");
        expect(btc.samples).toBe(3);
        expect(eth.samples).toBe(1);
    });

    it("sorts by avg expectancy, best first", () => {
        const scorecard = buildAssetScorecard(ROWS);
        expect(scorecard[0].avgExpectancy).toBeGreaterThanOrEqual(
            scorecard[scorecard.length - 1].avgExpectancy
        );
    });
});
