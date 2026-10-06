import { describe, expect, it } from "vitest";
import {
    buildStrategyScorecard,
    buildRegimeScorecard,
    buildAssetScorecard
} from "@analysis/scorecard.js";

describe("buildStrategyScorecard", () => {
    it("pools trades across folds", () => {
        const report = {
            results: [{
                symbol: "BTC/USDT", timeframe: "5m",
                rows: [
                    { strategy: "trend", fold: 1, trades: 2, totalPnl: 2 },
                    { strategy: "trend", fold: 2, trades: 10, totalPnl: -1 }
                ],
                trades: [
                    { strategy: "trend", label: "Trend", pnlPercent: 1, closedAt: 1, regime: "TRENDING" },
                    { strategy: "trend", label: "Trend", pnlPercent: 1, closedAt: 2, regime: "TRENDING" },
                    ...Array.from({ length: 10 }, (_, index) => ({
                        strategy: "trend", label: "Trend", pnlPercent: -0.1, closedAt: index + 3, regime: "RANGING"
                    }))
                ]
            }]
        };

        const scorecard = buildStrategyScorecard(report);
        const trend = scorecard.find((row) => row.strategy === "trend");

        expect(trend.trades).toBe(12);
        expect(trend.totalPnl).toBeCloseTo(1, 6);
    });
});

describe("buildRegimeScorecard", () => {
    it("falls back to UNKNOWN when regime is missing", () => {
        const scorecard = buildRegimeScorecard({
            results: [{
                trades: [{ strategy: "x", pnlPercent: 0.1, closedAt: 1 }]
            }]
        });
        expect(scorecard[0].regime).toBe("UNKNOWN");
    });
});

describe("buildAssetScorecard", () => {
    it("groups pooled trades by market", () => {
        const report = {
            results: [{
                symbol: "BTC/USDT",
                trades: [
                    { strategy: "trend", pnlPercent: 1, closedAt: 1 },
                    { strategy: "trend", pnlPercent: -0.5, closedAt: 2 }
                ]
            }]
        };
        const scorecard = buildAssetScorecard(report);
        expect(scorecard[0].symbol).toBe("BTC/USDT");
        expect(scorecard[0].trades).toBe(2);
    });
});

describe("buildStrategyScorecard (pooled)", () => {
    it("pools trades across folds", () => {
        const report = {
            results: [{
                symbol: "BTC/USDT", timeframe: "5m",
                rows: [
                    { strategy: "trend", fold: 1, trades: 2, totalPnl: 2 },
                    { strategy: "trend", fold: 2, trades: 10, totalPnl: -1 }
                ],
                trades: [
                    { strategy: "trend", label: "Trend", pnlPercent: 1, closedAt: 1, regime: "TRENDING" },
                    { strategy: "trend", label: "Trend", pnlPercent: 1, closedAt: 2, regime: "TRENDING" },
                    ...Array.from({ length: 10 }, (_, index) => ({
                        strategy: "trend", label: "Trend", pnlPercent: -0.1, closedAt: index + 3, regime: "RANGING"
                    }))
                ]
            }]
        };

        const scorecard = buildStrategyScorecard(report);
        const trend = scorecard.find((row) => row.strategy === "trend");

        expect(trend.trades).toBe(12);
        expect(trend.totalPnl).toBeCloseTo(1, 6);
    });
});

describe("strategy scorecard verdicts", () => {
    it("does not classify a negative strategy as promising", () => {
        function makeTrade(pnl, { strategy = "test", symbol = "BTC/USDT", timeframe = "5m", fold = 1 } = {}) {
            return {
                strategy,
                symbol,
                timeframe,
                fold,
                pnlPercent: pnl,
                grossPnlPercent: pnl,
                costDragPercent: 0,
                closedAt: fold * 1000
            };
        }

        const trades = [];
        for (let i = 0; i < 50; i += 1) {
            trades.push(makeTrade(-0.5, { fold: (i % 5) + 1 }));
        }

        const [row] = buildStrategyScorecard({ results: [{ symbol: "BTC/USDT", timeframe: "5m", trades }] });
        expect(row.verdict).not.toBe("PROMISING");
    });
});
