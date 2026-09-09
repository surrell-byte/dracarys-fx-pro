import { describe, expect, it, vi } from "vitest";
import { runBacktest, runWalkForwardBacktest } from "@analysis/backtestEngine.js";

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

describe("walk-forward context handling", () => {
    it("uses warm-up candles without scoring them", async () => {
        const candles = Array.from(
            { length: 20 },
            (_, i) => ({
                time: i + 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1
            })
        );
        const result =
            await runWalkForwardBacktest(
                candles,
                {
                    folds: 2,
                    warmupCandles: 5,
                    strategyIds: ["fakeStrategy"],
                    assetClass: "crypto",
                    costs: zeroCosts
                }
            );
        expect(result.folds).toHaveLength(2);
        /*
         * Fold 1:
         *
         * 10 scored candles
         * 0 context candles
         *
         * Fold 2:
         *
         * 5 context candles
         * 5 scored candles
         */
        expect(
            result.folds[0].contextCandles
        ).toBe(0);
        expect(
            result.folds[1].contextCandles
        ).toBe(5);
        expect(
            result.folds[1].scoreStartIndex
        ).toBe(5);
        expect(
            result.folds[1].candleCount
        ).toBe(10);
    });

    it("passes only pre-fold daily candles into HTF context", async () => {
        const candles = Array.from(
            { length: 20 },
            (_, i) => ({
                time: i + 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1
            })
        );

        /*
         * Create enough daily candles for the EMA200
         * HTF engine.
         */
        const dailyCandles = Array.from(
            { length: 220 },
            (_, i) => ({
                time: i + 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1
            })
        );

        const result = await runWalkForwardBacktest(candles, {
            folds: 2,
            warmupCandles: 5,
            strategyIds: ["fakeStrategy"],
            assetClass: "crypto",
            costs: zeroCosts,
            dailyCandles
        });

        // Only daily candles with time <= this fold's start should have been passed
        const expectedHtf = dailyCandles.filter((d) => d.time <= candles[10].time).length;
        expect(result.folds[1].higherTimeframeCandles).toBe(expectedHtf);
        expect(result.folds[1].higherTimeframeApplied).toBe(expectedHtf >= 200);
    });

    it("gives fold 1 a full external warm-up context when provided", async () => {
        const candles = Array.from({ length: 35 }, (_, i) => ({
            time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
        }));

        const result = await runWalkForwardBacktest(candles, {
            folds: 3, warmupCandles: 5, initialContextCandles: 5,
            strategyIds: ["fakeStrategy"], assetClass: "crypto", costs: zeroCosts
        });

        expect(result.summary.initialContextCandles).toBe(5);
        expect(result.summary.totalScoredCandles).toBe(30);
        expect(result.folds).toHaveLength(3);

        expect(result.folds[0].contextCandles).toBe(5);
        expect(result.folds[0].scoreStartIndex).toBe(5);
        expect(result.folds[0].fullWarmupAvailable).toBe(true);

        expect(result.folds[1].contextCandles).toBe(5);
        expect(result.folds[2].contextCandles).toBe(5);
        expect(result.summary.allFoldsHaveFullWarmup).toBe(true);
    });

    it("does not mark HTF as applied with insufficient daily history", async () => {
        const candles = Array.from({ length: 20 }, (_, i) => ({
            time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
        }));
        const dailyCandles = Array.from({ length: 100 }, (_, i) => ({
            time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
        }));

        const result = await runWalkForwardBacktest(candles, {
            folds: 2, warmupCandles: 5, initialContextCandles: 5,
            strategyIds: ["fakeStrategy"], assetClass: "crypto", costs: zeroCosts, dailyCandles
        });

        expect(result.folds[0].higherTimeframeApplied).toBe(false);
    });
});

describe("backtestEngine", () => {
    it("settles one binary prediction on the configured expiry candle", async () => {
        const candles = Array.from({ length: 8 }, (_, index) => ({
            time: index + 1,
            open: 100,
            high: 101,
            low: 99,
            close: index === 2 ? 101 : 100,
            volume: 1
        }));

        const result = await runBacktest(candles, {
            strategyIds: ["fakeStrategy"],
            expiryLengths: [2],
            assetClass: "crypto",
            costs: zeroCosts,
            minSampleSize: 1
        });

        expect(result.meta.binaryTradesResolved).toBe(1);
        expect(result.binaryStats).toContainEqual(expect.objectContaining({
            strategy: "fakeStrategy",
            expiryLength: 2,
            trades: 1,
            winRate: 100,
            reliable: true
        }));
    });

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

it("gives fold 1 a full external warm-up context when provided", async () => {
    const candles = Array.from({ length: 35 }, (_, i) => ({
        time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
    }));

    const result = await runWalkForwardBacktest(candles, {
        folds: 3, warmupCandles: 5, initialContextCandles: 5,
        strategyIds: ["fakeStrategy"], assetClass: "crypto", costs: zeroCosts
    });

    expect(result.summary.initialContextCandles).toBe(5);
    expect(result.summary.totalScoredCandles).toBe(30);
    expect(result.folds).toHaveLength(3);

    // Fold 1 must NOT cold-start.
    expect(result.folds[0].contextCandles).toBe(5);
    expect(result.folds[0].scoreStartIndex).toBe(5);
    expect(result.folds[0].fullWarmupAvailable).toBe(true);

    expect(result.folds[1].contextCandles).toBe(5);
    expect(result.folds[2].contextCandles).toBe(5);
    expect(result.summary.allFoldsHaveFullWarmup).toBe(true);
});

it("does not mark HTF as applied with insufficient daily history", async () => {
    const candles = Array.from({ length: 20 }, (_, i) => ({
        time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
    }));
    const dailyCandles = Array.from({ length: 100 }, (_, i) => ({
        time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
    }));

    const result = await runWalkForwardBacktest(candles, {
        folds: 2, warmupCandles: 5, initialContextCandles: 5,
        strategyIds: ["fakeStrategy"], assetClass: "crypto", costs: zeroCosts, dailyCandles
    });

    expect(result.folds[0].higherTimeframeApplied).toBe(false);
});

it("closed-candle audit: final daily candle starting at fold start is not counted as closed", async () => {
    const { countClosedHigherTimeframeCandles } = await import("@analysis/backtestEngine.js");

    const daily = Array.from({ length: 220 }, (_, i) => ({ time: i * 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
    const timestamp = daily[219].time; // final daily open equals fold-start

    const closed = countClosedHigherTimeframeCandles(daily, timestamp);
    expect(closed).toBe(219);
});
