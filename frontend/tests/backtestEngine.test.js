import { describe, expect, it, vi } from "vitest";
import { runBacktest } from "@analysis/backtestEngine.js";

const zeroCosts = {
    spreadPct: 0,
    slippagePct: 0,
    feePct: 0
};

vi.mock("@signals/signalEngine.js", async () => {
    const actual = await vi.importActual("@signals/signalEngine.js");

    const fakeStrategy = {
        label: "Fake Strategy",
        threshold: 0,
        weights: {
            trend: 1,
            momentum: 1,
            rsi: 1,
            bands: 1,
            pattern: 1,
            levels: 1,
            adxBoost: 1
        }
    };

    return {
        ...actual,
        STRATEGIES: {
            fakeStrategy
        },
        generateSignal: vi.fn((candles) => {
            if (candles.at(-1)?.time === 1) {
                return {
                    type: "BUY",
                    price: 100,
                    confidence: 75,
                    quality: "High",
                    strategy: "Fake Strategy",
                    risk: {
                        stopLoss: 95,
                        takeProfit: 110,
                        rewardMultiple: 2
                    },
                    regime: {
                        primary: "TRENDING"
                    },
                    ready: true
                };
            }

            return {
                type: "WAIT",
                price: candles.at(-1)?.close ?? 100,
                confidence: 0,
                quality: "None",
                strategy: "Fake Strategy",
                risk: {},
                regime: {
                    primary: "TRENDING"
                },
                ready: true
            };
        })
    };
});

describe("backtestEngine", () => {
    it("checks an open position even when the current signal is WAIT", async () => {
        const candles = [
            {
                time: 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1
            },
            {
                time: 2,
                open: 100,
                high: 101,
                low: 94,
                close: 96,
                volume: 1
            }
        ];

        const result = await runBacktest(candles, {
            strategyIds: ["fakeStrategy"],
            assetClass: "crypto",
            costs: zeroCosts,
            ambiguousFillRule: "conservative"
        });

        const trades = result.spotTradesByStrategy.fakeStrategy;

        expect(trades).toHaveLength(1);

        expect(trades[0]).toMatchObject({
            strategy: "fakeStrategy",
            side: "long",
            entry: 100,
            exit: 95,
            closeReason: "stop_loss",
            outcome: "loss",
            regime: "TRENDING"
        });
    });

    it("records regime on the completed trade", async () => {
        const candles = [
            {
                time: 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1
            },
            {
                time: 2,
                open: 100,
                high: 111,
                low: 99,
                close: 110,
                volume: 1
            }
        ];

        const result = await runBacktest(candles, {
            strategyIds: ["fakeStrategy"],
            assetClass: "crypto",
            costs: zeroCosts
        });

        const trades = result.spotTradesByStrategy.fakeStrategy;

        expect(trades).toHaveLength(1);
        expect(trades[0].regime).toBe("TRENDING");
        expect(trades[0].closeReason).toBe("take_profit");
    });
});
