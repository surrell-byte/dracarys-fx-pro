import { describe, expect, it } from "vitest";
import { runBacktest } from "@analysis/backtestEngine.js";
import { runSweep } from "@analysis/sweepRunner.js";
import { generateSignal } from "@signals/signalEngine.js";

const zeroCosts = { spreadPct: 0, slippagePct: 0, feePct: 0 };

function makeBreakoutCandles(count = 80) {
    return Array.from({ length: count }, (_, index) => ({
        time: index + 1,
        open: 100,
        high: index === 20 ? 105 : index === 60 ? 102 : 100.5,
        low: 99.5,
        close: index === 60 ? 101 : 100,
        volume: index === 60 ? 1.25 : 1
    }));
}

describe("sweep parameter plumbing", () => {
    const candles = makeBreakoutCandles(61);

    it("uses the swept lookback in the breakout range calculation", () => {
        const shortRange = generateSignal(candles, "breakout2", {
            strategyRiskOverrides: { lookback: 5, volumeRatio: 1 }
        });
        const longRange = generateSignal(candles, "breakout2", {
            strategyRiskOverrides: { lookback: 50, volumeRatio: 1 }
        });

        expect(shortRange.reason).toContain("Close above prior range resistance");
        expect(longRange.reason).toContain("Price inside range, no breakout");
    });

    it("uses the swept volume ratio as the breakout confirmation threshold", () => {
        const permissive = generateSignal(candles, "breakout2", {
            strategyRiskOverrides: { lookback: 5, volumeRatio: 1 }
        });
        const restrictive = generateSignal(candles, "breakout2", {
            strategyRiskOverrides: { lookback: 5, volumeRatio: 1.5 }
        });

        expect(permissive.reason).toContain("Volume >= 1x average");
        expect(restrictive.reason).toContain("Breakout lacks volume confirmation");
    });

    it("retains the current breakout defaults when overrides are omitted", () => {
        expect(generateSignal(candles, "breakout2")).toEqual(
            generateSignal(candles, "breakout2", {
                strategyRiskOverrides: { lookback: 50, volumeRatio: 1.5 }
            })
        );
    });

    it("does not carry one sweep combination's overrides into another", async () => {
        const baseOptions = {
            strategyIds: ["breakout2"],
            assetClass: "crypto",
            costs: zeroCosts,
            maxHoldCandles: 10
        };
        const combinations = [
            { strategyId: "breakout2", lookback: 5, volumeRatio: 1 },
            { strategyId: "breakout2", lookback: 50, volumeRatio: 1.5 }
        ];
        const batched = await runSweep({ candles: makeBreakoutCandles(), combinations, baseOptions });
        const isolated = await Promise.all(combinations.map((configuration) =>
            runSweep({ candles: makeBreakoutCandles(), combinations: [configuration], baseOptions })
        ));

        for (const [index, configuration] of combinations.entries()) {
            const batchedResult = batched.find((entry) =>
                entry.config.lookback === configuration.lookback &&
                entry.config.volumeRatio === configuration.volumeRatio
            );
            expect(batchedResult.result).toEqual(isolated[index][0].result);
        }
    });

    it("matches a normal backtest with an equivalent sweep configuration", async () => {
        const backtestCandles = makeBreakoutCandles();
        const baseOptions = {
            strategyIds: ["breakout2"],
            assetClass: "crypto",
            costs: zeroCosts,
            maxHoldCandles: 10
        };
        const normal = await runBacktest(backtestCandles, {
            ...baseOptions,
            extraSignalContext: {
                strategyRiskOverridesByStrategy: {
                    breakout2: { lookback: 5, volumeRatio: 1 }
                }
            }
        });
        const [sweep] = await runSweep({
            candles: backtestCandles,
            combinations: [{ strategyId: "breakout2", lookback: 5, volumeRatio: 1 }],
            baseOptions
        });
        const normalMetrics = normal.spotLeaderboard.find((entry) => entry.strategy === "breakout2");

        expect(sweep.result).toEqual(normal);
        expect(sweep.metrics.trades).toBe(normalMetrics.trades);
        expect(sweep.metrics.totalPnl).toBe(normalMetrics.totalPnl);
        expect(sweep.metrics.expectancy).toBe(normalMetrics.expectancy);
        expect(sweep.metrics.profitFactor).toBe(normalMetrics.profitFactor);
    });

    it("does not apply breakout overrides to unrelated strategies", () => {
        expect(generateSignal(candles, "trend", {
            strategyRiskOverrides: { lookback: 5, volumeRatio: 1 }
        })).toEqual(generateSignal(candles, "trend"));
    });
});