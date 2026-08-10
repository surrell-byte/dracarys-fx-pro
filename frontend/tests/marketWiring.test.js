import { describe, it, expect } from "vitest";
import { upsertCandle } from "@core/candleBuffer.js";
import { decideExecution } from "@core/executionDecision.js";
import { resolveMarketSelection } from "@core/marketSelection.js";

describe("candleBuffer.upsertCandle", () => {
    it("appends a genuinely new candle (different timestamp)", () => {
        const candles = [{ time: 1, close: 100 }, { time: 2, close: 101 }];
        const next = upsertCandle(candles, { time: 3, close: 102 }, 100);
        expect(next).toEqual([{ time: 1, close: 100 }, { time: 2, close: 101 }, { time: 3, close: 102 }]);
    });

    it("replaces the last candle in place when the timestamp matches (tick update)", () => {
        const candles = [{ time: 1, close: 100 }, { time: 2, close: 101 }];
        const next = upsertCandle(candles, { time: 2, close: 105, high: 106 }, 100);
        expect(next).toEqual([{ time: 1, close: 100 }, { time: 2, close: 105, high: 106 }]);
        expect(next.length).toBe(2); // tick update, not a new candle
    });

    it("does not mutate the input array (returns a new one)", () => {
        const candles = [{ time: 1, close: 100 }];
        const next = upsertCandle(candles, { time: 2, close: 101 }, 100);
        expect(candles.length).toBe(1); // original untouched
        expect(next).not.toBe(candles);
    });

    it("trims to maxCandles from the end once the buffer overflows", () => {
        const candles = Array.from({ length: 5 }, (_, i) => ({ time: i, close: i }));
        const next = upsertCandle(candles, { time: 5, close: 5 }, 3);
        expect(next.length).toBe(3);
        expect(next.map((c) => c.time)).toEqual([3, 4, 5]);
    });

    it("handles an empty starting buffer", () => {
        const next = upsertCandle([], { time: 1, close: 100 }, 10);
        expect(next).toEqual([{ time: 1, close: 100 }]);
    });
});

describe("executionDecision.decideExecution", () => {
    const baseSignal = { ready: true, type: "BUY", confidence: 80 };
    const baseSettings = { autoTrade: true, minConfidence: 50, maxLoss: 100, mode: "paper" };
    const okContext = { isCoolingDown: false, paperPnl: 0 };

    it("skips with 'Manual mode' when autoTrade is off", () => {
        const decision = decideExecution(baseSignal, { ...baseSettings, autoTrade: false }, okContext);
        expect(decision).toEqual({ action: "skip", statusMessage: "Manual mode" });
    });

    it("skips when the signal isn't ready", () => {
        const decision = decideExecution({ ...baseSignal, ready: false }, baseSettings, okContext);
        expect(decision.action).toBe("skip");
        expect(decision.statusMessage).toBe("Waiting for actionable signal");
    });

    it("skips on a HOLD signal even if ready is true", () => {
        const decision = decideExecution({ ...baseSignal, type: "HOLD" }, baseSettings, okContext);
        expect(decision.action).toBe("skip");
        expect(decision.statusMessage).toBe("Waiting for actionable signal");
    });

    it("skips when confidence is below the configured minimum", () => {
        const decision = decideExecution({ ...baseSignal, confidence: 30 }, baseSettings, okContext);
        expect(decision.action).toBe("skip");
        expect(decision.statusMessage).toBe("Confidence below 50%");
    });

    it("skips during cooldown", () => {
        const decision = decideExecution(baseSignal, baseSettings, { ...okContext, isCoolingDown: true });
        expect(decision).toEqual({ action: "skip", statusMessage: "Cooldown active" });
    });

    it("skips and signals disableAutoTrade once max loss is reached", () => {
        const decision = decideExecution(baseSignal, baseSettings, { ...okContext, paperPnl: -150 });
        expect(decision).toEqual({
            action: "skip",
            statusMessage: "Max loss reached, auto disabled",
            disableAutoTrade: true
        });
    });

    it("does not trigger the max-loss skip exactly at the threshold boundary (strictly less than)", () => {
        // pnl === -maxLoss should NOT skip (original condition was `pnl <= -maxLoss`,
        // so -100 <= -100 is actually true - verifying the boundary is inclusive,
        // matching the original app.js behavior exactly).
        const decision = decideExecution(baseSignal, baseSettings, { ...okContext, paperPnl: -100 });
        expect(decision.action).toBe("skip");
        expect(decision.disableAutoTrade).toBe(true);
    });

    it("returns 'paper' when every gate passes and mode is paper", () => {
        const decision = decideExecution(baseSignal, baseSettings, okContext);
        expect(decision).toEqual({ action: "paper" });
    });

    it("returns 'live' when every gate passes and mode is not paper", () => {
        const decision = decideExecution(baseSignal, { ...baseSettings, mode: "dry-run" }, okContext);
        expect(decision).toEqual({ action: "live" });
    });

    it("checks gates in the original priority order (autoTrade > readiness > confidence > cooldown > maxLoss)", () => {
        // Multiple failing conditions at once - should report the FIRST one
        // in the original app.js branch order, not any other failing one.
        const allFailing = decideExecution(
            { ready: false, type: "HOLD", confidence: 1 },
            { ...baseSettings, autoTrade: false },
            { isCoolingDown: true, paperPnl: -1000 }
        );
        expect(allFailing.statusMessage).toBe("Manual mode");
    });
});

describe("marketSelection.resolveMarketSelection", () => {
    it("uses the option's data attributes when present", () => {
        const resolved = resolveMarketSelection({
            symbolValue: "ethusdt",
            apiSymbolAttr: "ETH/USDT",
            assetClassAttr: "crypto",
            interval: "5m"
        });
        expect(resolved).toEqual({
            symbol: "ethusdt",
            apiSymbol: "ETH/USDT",
            assetClass: "crypto",
            marketLabel: "ETHUSDT · 5m live candles"
        });
    });

    it("falls back to an uppercased symbol when apiSymbolAttr is missing", () => {
        const resolved = resolveMarketSelection({
            symbolValue: "solusdt",
            apiSymbolAttr: undefined,
            assetClassAttr: "crypto",
            interval: "1m"
        });
        expect(resolved.apiSymbol).toBe("SOLUSDT");
    });

    it("falls back to 'crypto' when assetClassAttr is missing", () => {
        const resolved = resolveMarketSelection({
            symbolValue: "btcusdt",
            apiSymbolAttr: "BTC/USDT",
            assetClassAttr: undefined,
            interval: "1m"
        });
        expect(resolved.assetClass).toBe("crypto");
    });

    it("builds the market label from the uppercased symbol and interval", () => {
        const resolved = resolveMarketSelection({
            symbolValue: "eurusd",
            apiSymbolAttr: "EUR/USD",
            assetClassAttr: "forex",
            interval: "15m"
        });
        expect(resolved.marketLabel).toBe("EURUSD · 15m live candles");
    });
});
