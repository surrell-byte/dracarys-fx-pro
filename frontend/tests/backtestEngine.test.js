import { describe, expect, it, vi } from "vitest";
import { runBacktest } from "@analysis/backtestEngine.js";

const dummyCandles = [
    { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { time: 2, open: 100, high: 105, low: 99, close: 104, volume: 1 },
    { time: 3, open: 104, high: 106, low: 103, close: 105, volume: 1 }
];

vi.mock("@signals/signalEngine.js", async () => {
    const actual = await vi.importActual("@signals/signalEngine.js");
    const fakeStrategy = {
        label: "Fake Strategy",
        threshold: 0,
        weights: { trend: 1, momentum: 1, rsi: 1, bands: 1, pattern: 1, levels: 1, adxBoost: 1 }
    };
    return {
        ...actual,
        STRATEGIES: { fakeStrategy },
        generateSignal: () => ({
            type: "BUY",
            price: 100,
            confidence: 50,
            quality: "Medium",
            strategy: "Fake Strategy",
            risk: { stopLoss: 99, takeProfit: 104, rewardMultiple: 1 },
            regime: { primary: "TRENDING" },
            ready: true
        })
    };
});

describe("backtestEngine", () => {
    it("propagates regime into spot trades", async () => {
        const result = await runBacktest(dummyCandles, {
            strategyIds: ["fakeStrategy"],
            assetClass: "crypto",
            costs: { spreadPct: 0, slippagePct: 0, feePct: 0 }
        });

        expect(result.spotTradesByStrategy.fakeStrategy).toBeDefined();
        expect(result.spotTradesByStrategy.fakeStrategy[0].regime).toBe("TRENDING");
        expect(result.spotLeaderboard[0].regime).toBe("TRENDING");
    });
});
