import { describe, it, expect } from "vitest";
import {
    computeExpectancy,
    computeDrawdownStats,
    computeRiskAdjustedReturns,
    computeStreaks,
    computeSampleConfidence,
    computeStrategyStats,
    computeRollingPerformance
} from "@analysis/performanceStats.js";

describe("computeExpectancy", () => {
    it("handles the empty case without dividing by zero", () => {
        const result = computeExpectancy([]);
        expect(result.trades).toBe(0);
        expect(result.winRate).toBeNull();
        expect(result.expectancy).toBeNull();
    });

    it("matches hand-calculated expectancy/profit-factor for a known sample", () => {
        // 6 wins @ +2%, 4 losses @ -1%
        const trades = [
            ...Array(6).fill({ pnlPercent: 2 }),
            ...Array(4).fill({ pnlPercent: -1 })
        ];
        const result = computeExpectancy(trades);
        expect(result.trades).toBe(10);
        expect(result.winRate).toBeCloseTo(0.6, 10);
        expect(result.avgWin).toBeCloseTo(2, 10);
        expect(result.avgLoss).toBeCloseTo(1, 10);
        // expectancy = 0.6*2 - 0.4*1 = 0.8
        expect(result.expectancy).toBeCloseTo(0.8, 10);
        // profitFactor = grossProfit/grossLoss = 12/4 = 3
        expect(result.profitFactor).toBeCloseTo(3, 10);
    });

    it("returns null profit factor (not Infinity) when there are zero losses", () => {
        const trades = [{ pnlPercent: 5 }, { pnlPercent: 3 }];
        const result = computeExpectancy(trades);
        expect(result.profitFactor).toBeNull();
    });

    it("returns 0 profit factor when there are zero wins and zero losses (all breakeven)", () => {
        const trades = [{ pnlPercent: 0 }, { pnlPercent: 0 }];
        const result = computeExpectancy(trades);
        expect(result.profitFactor).toBe(0);
    });
});

describe("computeDrawdownStats", () => {
    it("computes max drawdown correctly against a known equity curve", () => {
        // running: 5, 3, 0, 4 | peak: 5,5,5,5 | dd: 0,2,5,1 -> maxDD = 5
        const trades = [{ pnlPercent: 5 }, { pnlPercent: -2 }, { pnlPercent: -3 }, { pnlPercent: 4 }];
        const stats = computeDrawdownStats(trades);
        expect(stats.maxDrawdown).toBeCloseTo(5, 10);
        expect(stats.totalReturn).toBeCloseTo(4, 10);
    });

    it("is order-dependent - a big loss up front produces a smaller drawdown than the same loss after a run-up", () => {
        // a: gain first, then losses -> drawdown measured from the peak
        // after the gain. d: loss first (before any peak was set above 0)
        // -> smaller drawdown, even though both orderings sum to the same
        // total return.
        const a = [{ pnlPercent: 5 }, { pnlPercent: -2 }, { pnlPercent: -3 }, { pnlPercent: 4 }];
        const d = [{ pnlPercent: -3 }, { pnlPercent: 5 }, { pnlPercent: -2 }, { pnlPercent: 4 }];
        const statsA = computeDrawdownStats(a);
        const statsD = computeDrawdownStats(d);
        expect(statsA.totalReturn).toBeCloseTo(statsD.totalReturn, 10);
        expect(statsA.maxDrawdown).toBeCloseTo(5, 10);
        expect(statsD.maxDrawdown).toBeCloseTo(3, 10);
        expect(statsA.maxDrawdown).not.toBeCloseTo(statsD.maxDrawdown, 5);
    });

    it("has zero drawdown on a monotonically increasing equity curve", () => {
        const trades = [{ pnlPercent: 1 }, { pnlPercent: 2 }, { pnlPercent: 3 }];
        expect(computeDrawdownStats(trades).maxDrawdown).toBe(0);
    });

    it("handles the empty case", () => {
        const stats = computeDrawdownStats([]);
        expect(stats.maxDrawdown).toBe(0);
        expect(stats.recoveryFactor).toBeNull();
    });
});

describe("computeRiskAdjustedReturns", () => {
    it("returns nulls for fewer than 2 trades", () => {
        const stats = computeRiskAdjustedReturns([{ pnlPercent: 5 }]);
        expect(stats.sharpe).toBeNull();
        expect(stats.sortino).toBeNull();
    });

    it("sharpe is null (not divide-by-zero garbage) when every trade returns exactly the same amount", () => {
        const trades = Array(10).fill({ pnlPercent: 2 });
        const stats = computeRiskAdjustedReturns(trades);
        // stdDev = 0 -> sharpe should be null per the guard, not Infinity/NaN
        expect(stats.sharpe).toBeNull();
    });

    it("produces a finite sharpe for a mixed-return series", () => {
        const trades = [{ pnlPercent: 2 }, { pnlPercent: -1 }, { pnlPercent: 3 }, { pnlPercent: -2 }, { pnlPercent: 1 }];
        const stats = computeRiskAdjustedReturns(trades);
        expect(Number.isFinite(stats.sharpe)).toBe(true);
    });
});

describe("computeStreaks", () => {
    it("finds the longest win and loss streaks correctly", () => {
        const trades = [
            { pnlPercent: 1 }, { pnlPercent: 1 }, { pnlPercent: 1 }, // win streak of 3
            { pnlPercent: -1 }, // breaks it
            { pnlPercent: 1 },
            { pnlPercent: -1 }, { pnlPercent: -1 }, { pnlPercent: -1 }, { pnlPercent: -1 } // loss streak of 4
        ];
        const streaks = computeStreaks(trades);
        expect(streaks.longestWinStreak).toBe(3);
        expect(streaks.longestLossStreak).toBe(4);
    });

    it("a breakeven (0%) trade resets both streaks", () => {
        const trades = [{ pnlPercent: 1 }, { pnlPercent: 1 }, { pnlPercent: 0 }, { pnlPercent: 1 }];
        const streaks = computeStreaks(trades);
        expect(streaks.longestWinStreak).toBe(2); // the 2 before the 0%, not 3 total
    });
});

describe("computeSampleConfidence", () => {
    it("flags small samples as unreliable", () => {
        const trades = Array(5).fill({ pnlPercent: 1 });
        const conf = computeSampleConfidence(trades, { minSampleSize: 20 });
        expect(conf.reliable).toBe(false);
    });

    it("flags large samples as reliable and returns a bounded CI", () => {
        const trades = [
            ...Array(60).fill({ pnlPercent: 1 }),
            ...Array(40).fill({ pnlPercent: -1 })
        ];
        const conf = computeSampleConfidence(trades, { minSampleSize: 20 });
        expect(conf.reliable).toBe(true);
        expect(conf.confidenceInterval.lower).toBeGreaterThanOrEqual(0);
        expect(conf.confidenceInterval.upper).toBeLessThanOrEqual(100);
        expect(conf.confidenceInterval.lower).toBeLessThan(conf.confidenceInterval.upper);
    });
});

describe("computeStrategyStats (aggregator)", () => {
    it("bundles every sub-stat without throwing on a realistic mixed sample", () => {
        const trades = [
            { pnlPercent: 2 }, { pnlPercent: -1 }, { pnlPercent: 3 }, { pnlPercent: -2 },
            { pnlPercent: 1 }, { pnlPercent: -0.5 }, { pnlPercent: 4 }, { pnlPercent: -1.5 }
        ];
        const stats = computeStrategyStats(trades);
        expect(stats.trades).toBe(8);
        expect(typeof stats.expectancy).toBe("number");
        expect(typeof stats.maxDrawdown).toBe("number");
        expect(stats.sampleConfidence).toBeDefined();
        expect(stats.longestWinStreak).toBeGreaterThanOrEqual(1);
    });
});

describe("computeRollingPerformance", () => {
    it("returns empty when there are fewer trades than the window size", () => {
        const trades = Array(10).fill({ pnlPercent: 1 });
        expect(computeRollingPerformance(trades, 50, 10)).toEqual([]);
    });

    it("produces correctly-sized, correctly-spaced windows", () => {
        const trades = Array(100).fill(null).map((_, i) => ({ pnlPercent: i % 2 === 0 ? 1 : -1 }));
        const windows = computeRollingPerformance(trades, 20, 10);
        // windows starting at 0,10,20,...,80 (80+20=100 <= 100) -> 9 windows
        expect(windows.length).toBe(9);
        expect(windows[0].startIndex).toBe(0);
        expect(windows[0].endIndex).toBe(19);
        expect(windows[1].startIndex).toBe(10);
    });
});
