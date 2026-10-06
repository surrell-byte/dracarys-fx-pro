import { describe, expect, it } from "vitest";
import {
    computeRStats,
    tradeRMultiple,
    tradeRiskPercent
} from "@analysis/rMetrics.js";

describe("R-multiple metrics", () => {
    it("calculates risk percentage and R-multiple from stop distance", () => {
        const trade = {
            entry: 100,
            stopLoss: 98,
            pnlPercent: 3
        };

        expect(tradeRiskPercent(trade)).toBeCloseTo(2);
        expect(tradeRMultiple(trade)).toBeCloseTo(1.5);
    });

    it("aggregates net and gross R expectancy, profit factor, and drawdown", () => {
        const trades = [
            { entry: 100, stopLoss: 98, pnlPercent: 2, grossPnlPercent: 3 },
            { entry: 100, stopLoss: 98, pnlPercent: -1, grossPnlPercent: -2 }
        ];

        const stats = computeRStats(trades);

        expect(stats.tradesWithR).toBe(2);
        expect(stats.expectancyR).toBeCloseTo(0.25);
        expect(stats.profitFactorR).toBeCloseTo(2);
        expect(stats.totalR).toBeCloseTo(0.5);
        expect(stats.maxDrawdownR).toBeCloseTo(0.5);
    });
});
