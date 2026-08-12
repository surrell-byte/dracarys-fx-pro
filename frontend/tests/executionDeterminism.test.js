import { describe, expect, it } from "vitest";
import { evaluateCandleExit } from "@analysis/executionSimulator.js";

const costs = {
    spreadPct: 0,
    slippagePct: 0,
    feePct: 0
};

function runExecutionScenario({ position, candles, maxHoldCandles = 100 }) {
    let current = {
        ...position,
        candlesSinceOpen: 0
    };

    for (const candle of candles) {
        current.candlesSinceOpen += 1;
        const result = evaluateCandleExit({
            position: current,
            candle,
            candlesSinceOpen: current.candlesSinceOpen,
            maxHoldCandles,
            ambiguousFillRule: "conservative",
            assetClass: "crypto",
            costs
        });
        if (result) {
            return result;
        }
    }
    return null;
}

describe("execution simulator determinism", () => {
    it("produces deterministic outcomes for identical candle sequences", () => {
        const position = {
            type: "BUY",
            entryPrice: 100,
            stopLoss: 95,
            takeProfit: 105
        };

        const candles = [
            { time: 1, open: 100, high: 102, low: 99, close: 101 },
            { time: 2, open: 101, high: 106, low: 100, close: 105 }
        ];

        const resultA = runExecutionScenario({ position, candles });
        const resultB = runExecutionScenario({ position, candles });
        expect(resultA).toEqual(resultB);
    });

    it("does not accidentally use candle close when TP was touched", () => {
        const result = runExecutionScenario({
            position: {
                type: "BUY",
                entryPrice: 100,
                stopLoss: 95,
                takeProfit: 105
            },
            candles: [
                { time: 1, open: 100, high: 110, low: 99, close: 101 }
            ]
        });

        expect(result.exitPrice).toBe(105);
        expect(result.closeReason).toBe("take_profit");
    });
});
