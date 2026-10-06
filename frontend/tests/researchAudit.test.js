import { describe, expect, it } from "vitest";
import {
    buildStrategyScorecard,
    buildRegimeScorecard,
    buildAssetScorecard,
    buildTimeframeScorecard,
    buildStrategyMarketMatrix,
    buildStrategyTimeframeMatrix,
    bootstrapMeanCI,
    bootstrapBlockMeanCI
} from "@analysis/scorecard.js";

const TRADE = (strategy, pnlPercent, {
    symbol = "BTC/USDT", timeframe = "5m", regime = "TRENDING", closedAt = 1, fold = 1
} = {}) => ({ strategy, label: strategy, pnlPercent, symbol, timeframe, regime, closedAt, fold });

const REPORT = {
    results: [{
        symbol: "BTC/USDT", assetClass: "crypto", timeframe: "5m",
        rows: [
            { symbol: "BTC/USDT", timeframe: "5m", fold: 1, strategy: "trend", trades: 3, totalPnl: 1.5, expectancy: 0.5 },
            { symbol: "BTC/USDT", timeframe: "5m", fold: 2, strategy: "trend", trades: 3, totalPnl: -0.3, expectancy: -0.1 }
        ],
        trades: [
            TRADE("trend", 1, { fold: 1, closedAt: 1 }),
            TRADE("trend", 0.5, { fold: 1, closedAt: 2 }),
            TRADE("trend", 0, { fold: 1, closedAt: 3 }),
            TRADE("trend", -0.1, { fold: 2, closedAt: 4 }),
            TRADE("trend", -0.1, { fold: 2, closedAt: 5, regime: "RANGING" }),
            TRADE("trend", -0.1, { fold: 2, closedAt: 6 })
        ]
    }]
};

describe("bootstrapMeanCI", () => {
    it("is deterministic for a fixed seed", () => {
        const trades = [{ pnlPercent: 1 }, { pnlPercent: 2 }, { pnlPercent: -1 }, { pnlPercent: 3 }];
        const first = bootstrapMeanCI(trades, { iterations: 500, seed: "test" });
        const second = bootstrapMeanCI(trades, { iterations: 500, seed: "test" });
        expect(first).toEqual(second);
    });

    it("returns null for empty samples", () => {
        expect(bootstrapMeanCI([])).toBeNull();
    });
});

describe("buildStrategyScorecard", () => {
    it("uses pooled trades rather than averaging fold expectancies", () => {
        const scorecard = buildStrategyScorecard(REPORT);
        const trend = scorecard.find((row) => row.strategy === "trend");
        expect(trend.trades).toBe(6);
        expect(trend.totalPnl).toBeCloseTo(1.2, 6);
    });

    it("counts no-trade/negative folds in consistency denominator", () => {
        const scorecard = buildStrategyScorecard(REPORT);
        const trend = scorecard.find((row) => row.strategy === "trend");
        expect(trend.totalFolds).toBe(2);
        expect(trend.profitableFolds).toBe(1);
        expect(trend.profitableFoldPct).toBe(50);
    });
});

describe("regime scorecard", () => {
    it("uses actual trade regimes", () => {
        const scorecard = buildRegimeScorecard(REPORT);
        expect(scorecard.find((row) => row.regime === "TRENDING").trades).toBe(5);
        expect(scorecard.find((row) => row.regime === "RANGING").trades).toBe(1);
    });
});

describe("asset scorecard", () => {
    it("groups pooled trades by market", () => {
        const scorecard = buildAssetScorecard(REPORT);
        expect(scorecard[0].symbol).toBe("BTC/USDT");
        expect(scorecard[0].trades).toBe(6);
    });
});

describe("timeframe scorecard", () => {
    it("groups pooled trades by timeframe", () => {
        const scorecard = buildTimeframeScorecard(REPORT);
        expect(scorecard[0].timeframe).toBe("5m");
        expect(scorecard[0].trades).toBe(6);
    });
});

describe("strategy matrices", () => {
    it("builds strategy × market rows", () => {
        const matrix = buildStrategyMarketMatrix(REPORT);
        expect(matrix).toHaveLength(1);
        expect(matrix[0]).toMatchObject({ strategy: "trend", symbol: "BTC/USDT", trades: 6 });
    });

    it("builds strategy × timeframe rows", () => {
        const matrix = buildStrategyTimeframeMatrix(REPORT);
        expect(matrix).toHaveLength(1);
        expect(matrix[0]).toMatchObject({ strategy: "trend", timeframe: "5m", trades: 6 });
    });
});

describe(
    "bootstrapBlockMeanCI",
    () => {
        it(
            "is deterministic for a fixed seed",
            () => {
                const trades = [
                    {
                        pnlPercent: 1,
                        symbol: "BTC/USDT",
                        timeframe: "5m",
                        fold: 1
                    },
                    {
                        pnlPercent: 2,
                        symbol: "BTC/USDT",
                        timeframe: "5m",
                        fold: 1
                    },
                    {
                        pnlPercent: -1,
                        symbol: "BTC/USDT",
                        timeframe: "5m",
                        fold: 2
                    },
                    {
                        pnlPercent: 3,
                        symbol: "ETH/USDT",
                        timeframe: "5m",
                        fold: 1
                    }
                ];

                const first =
                    bootstrapBlockMeanCI(
                        trades,
                        {
                            iterations: 500,
                            seed: "block-test"
                        }
                    );

                const second =
                    bootstrapBlockMeanCI(
                        trades,
                        {
                            iterations: 500,
                            seed: "block-test"
                        }
                    );

                expect(first)
                    .toEqual(second);
            }
        );

        it(
            "returns null for empty samples",
            () => {
                expect(
                    bootstrapBlockMeanCI([])
                ).toBeNull();
            }
        );
    }
);
