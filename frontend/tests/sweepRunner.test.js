import { describe, expect, it, vi } from "vitest";
import { STRATEGIES } from "@signals/strategyRegistry.js";
import {
    buildSweepCacheKey,
    dedupeSweepConfigurations,
    generateSweepCombinations,
    resolveSweepStrategy,
    runSweep
} from "@analysis/sweepRunner.js";

describe("sweepRunner", () => {
    it("keeps separate parameter combinations isolated and cache-keyed", async () => {
        const executor = vi.fn(async (_candles, options) => {
            const strategyId = options.strategyIds[0];
            const override = options.extraSignalContext?.strategyRiskOverridesByStrategy?.[strategyId] ?? {};
            const atr = override.atrStopMultiplier ?? 0;
            const reward = override.rewardMultiple ?? 0;
            return {
                spotLeaderboard: [{
                    strategy: strategyId,
                    label: STRATEGIES[strategyId]?.label ?? strategyId,
                    trades: 2,
                    totalPnl: (atr + reward) * 10,
                    expectancy: 0.12,
                    profitFactor: 1.25,
                    maxDrawdown: 5,
                    expectancyR: 0.8,
                    totalR: 2.0,
                    profitFactorR: 1.3,
                    sharpe: 1.0
                }],
                spotTradesByStrategy: {
                    [strategyId]: [
                        { pnlPercent: 10, grossPnlPercent: 12, riskPercent: 5 },
                        { pnlPercent: -5, grossPnlPercent: -4, riskPercent: 5 }
                    ]
                }
            };
        });

        const combinations = generateSweepCombinations({
            strategyId: "trend",
            atr: [1.2, 1.8],
            reward: [2.0, 2.5],
            assetClass: "crypto"
        });

        const results = await runSweep({
            candles: Array.from({ length: 50 }, (_, index) => ({
                time: index + 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100 + index * 0.1,
                volume: 1
            })),
            strategyIds: ["trend"],
            combinations,
            executor,
            baseOptions: { assetClass: "crypto" }
        });

        expect(results).toHaveLength(4);
        expect(new Set(results.map((result) => result.cacheKey)).size).toBe(4);
        expect(results.every((result) => result.config.strategyId === "trend")).toBe(true);
        expect(executor).toHaveBeenCalledTimes(4);
    });

    it("marks empty and failed runs explicitly without collapsing them into successful zeros", async () => {
        const executor = vi.fn(async (_candles, options) => {
            const override = options.extraSignalContext?.strategyRiskOverridesByStrategy?.trend ?? {};
            if (override.rewardMultiple === 99) {
                throw new Error("bad run");
            }
            return {
                spotLeaderboard: [{
                    strategy: "trend",
                    label: "Trend Follow",
                    trades: 0,
                    totalPnl: 0,
                    expectancy: 0,
                    profitFactor: 0,
                    maxDrawdown: 0,
                    expectancyR: 0,
                    totalR: 0,
                    profitFactorR: 0
                }],
                spotTradesByStrategy: { trend: [] }
            };
        });

        const results = await runSweep({
            candles: Array.from({ length: 20 }, (_, index) => ({
                time: index + 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1
            })),
            strategyIds: ["trend"],
            combinations: [
                { strategyId: "trend", atr: 1.2, reward: 2.0, assetClass: "crypto" },
                { strategyId: "trend", atr: 1.2, reward: 99, assetClass: "crypto" }
            ],
            executor,
            baseOptions: { assetClass: "crypto" }
        });

        expect(results[0].status).toBe("empty");
        expect(results[1].status).toBe("failed");
        expect(results[1].error).toMatch(/bad run/);
    });

    it("uses the canonical strategy registry and produces a deterministic cache key", () => {
        const strategy = resolveSweepStrategy("trend");
        expect(strategy).toBe(STRATEGIES.trend);

        const first = buildSweepCacheKey({ strategyId: "trend", atr: 1.2, reward: 2.5, assetClass: "crypto" });
        const second = buildSweepCacheKey({ strategyId: "trend", reward: 2.5, atr: 1.2, assetClass: "crypto" });
        expect(first).toBe(second);
    });

    it("deduplicates identical configurations and preserves deterministic ranking", async () => {
        const executor = vi.fn(async (_candles, options) => {
            const override = options.extraSignalContext?.strategyRiskOverridesByStrategy?.trend ?? {};
            return {
                spotLeaderboard: [{
                    strategy: "trend",
                    label: "Trend Follow",
                    trades: 2,
                    totalPnl: override.rewardMultiple === 3 ? 50 : 10,
                    expectancy: override.rewardMultiple === 3 ? 0.4 : 0.1,
                    profitFactor: 1.2,
                    maxDrawdown: 10,
                    expectancyR: override.rewardMultiple === 3 ? 0.9 : 0.2,
                    totalR: override.rewardMultiple === 3 ? 3.5 : 0.8,
                    profitFactorR: 1.5,
                    sharpe: 1.0
                }],
                spotTradesByStrategy: {
                    trend: [
                        { pnlPercent: 10, grossPnlPercent: 12, riskPercent: 5 },
                        { pnlPercent: -5, grossPnlPercent: -4, riskPercent: 5 }
                    ]
                }
            };
        });

        const combinations = [
            { strategyId: "trend", atr: 1.2, reward: 2.5, assetClass: "crypto" },
            { strategyId: "trend", reward: 2.5, atr: 1.2, assetClass: "crypto" },
            { strategyId: "trend", atr: 1.2, reward: 3.0, assetClass: "crypto" }
        ];

        const deduped = dedupeSweepConfigurations(combinations);
        expect(deduped).toHaveLength(2);

        const results = await runSweep({
            candles: Array.from({ length: 20 }, (_, index) => ({
                time: index + 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1
            })),
            strategyIds: ["trend"],
            combinations: deduped,
            executor,
            baseOptions: { assetClass: "crypto" }
        });

        expect(results.map((entry) => entry.config.reward)).toEqual([3.0, 2.5]);
    });
});
