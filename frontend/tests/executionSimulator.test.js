import { describe, expect, it } from "vitest";
import { createEntryFill, evaluateCandleExit, normalizeCloseReason } from "@analysis/executionSimulator.js";

const zeroCosts = {
    spreadPct: 0,
    slippagePct: 0,
    feePct: 0
};

describe("execution simulator", () => {
    it("normalizes all close-reason spellings into the shared scheduler vocabulary", () => {
        expect(normalizeCloseReason("end_of_data")).toBe("timeout");
        expect(normalizeCloseReason("expired")).toBe("timeout");
        expect(normalizeCloseReason("stopLoss")).toBe("stop_loss");
        expect(normalizeCloseReason("takeProfit")).toBe("take_profit");
    });

    it("takes BUY profit at TP", () => {
        const result = evaluateCandleExit({
            position: {
                type: "BUY",
                entryPrice: 100,
                stopLoss: 95,
                takeProfit: 105
            },
            candle: {
                time: 1,
                open: 100,
                high: 106,
                low: 99,
                close: 104
            },
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("take_profit");
        expect(result.outcome).toBe("win");
        expect(result.exitPrice).toBe(105);
        expect(result.pnlPct).toBe(5);
    });

    it("takes BUY loss at SL", () => {
        const result = evaluateCandleExit({
            position: {
                type: "BUY",
                entryPrice: 100,
                stopLoss: 95,
                takeProfit: 105
            },
            candle: {
                time: 1,
                open: 100,
                high: 101,
                low: 94,
                close: 97
            },
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("stop_loss");
        expect(result.outcome).toBe("loss");
        expect(result.exitPrice).toBe(95);
        expect(result.pnlPct).toBe(-5);
    });

    it("takes SELL profit at TP", () => {
        const result = evaluateCandleExit({
            position: {
                type: "SELL",
                entryPrice: 100,
                stopLoss: 105,
                takeProfit: 95
            },
            candle: {
                time: 1,
                open: 100,
                high: 101,
                low: 94,
                close: 96
            },
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("take_profit");
        expect(result.outcome).toBe("win");
        expect(result.exitPrice).toBe(95);
        expect(result.pnlPct).toBe(5);
    });

    it("takes SELL loss at SL", () => {
        const result = evaluateCandleExit({
            position: {
                type: "SELL",
                entryPrice: 100,
                stopLoss: 105,
                takeProfit: 95
            },
            candle: {
                time: 1,
                open: 100,
                high: 106,
                low: 99,
                close: 104
            },
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("stop_loss");
        expect(result.outcome).toBe("loss");
        expect(result.exitPrice).toBe(105);
        expect(result.pnlPct).toBe(-5);
    });

    it("uses conservative SL-first handling when both levels are hit", () => {
        const result = evaluateCandleExit({
            position: {
                type: "BUY",
                entryPrice: 100,
                stopLoss: 95,
                takeProfit: 105
            },
            candle: {
                time: 1,
                open: 100,
                high: 106,
                low: 94,
                close: 100
            },
            ambiguousFillRule: "conservative",
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("stop_loss");
        expect(result.outcome).toBe("loss");
    });

    it("can use optimistic TP-first handling", () => {
        const result = evaluateCandleExit({
            position: {
                type: "BUY",
                entryPrice: 100,
                stopLoss: 95,
                takeProfit: 105
            },
            candle: {
                time: 1,
                open: 100,
                high: 106,
                low: 94,
                close: 100
            },
            ambiguousFillRule: "optimistic",
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("take_profit");
        expect(result.outcome).toBe("win");
    });

    it("defaults to a candle-close interpretation for SL/TP overlap", () => {
        const result = evaluateCandleExit({
            position: {
                type: "BUY",
                entryPrice: 100,
                stopLoss: 95,
                takeProfit: 105
            },
            candle: {
                time: 1,
                open: 100,
                high: 106,
                low: 94,
                close: 107
            },
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("take_profit");
        expect(result.outcome).toBe("win");
        expect(result.exitPrice).toBe(105);
    });

    it("uses the same close-biased interpretation for SELL overlaps", () => {
        const result = evaluateCandleExit({
            position: {
                type: "SELL",
                entryPrice: 100,
                stopLoss: 105,
                takeProfit: 95
            },
            candle: {
                time: 1,
                open: 100,
                high: 106,
                low: 93,
                close: 92
            },
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("take_profit");
        expect(result.outcome).toBe("win");
        expect(result.exitPrice).toBe(95);
    });

    it("falls back to the close-biased interpretation when the overlap rule is unrecognized", () => {
        const result = evaluateCandleExit({
            position: {
                type: "BUY",
                entryPrice: 100,
                stopLoss: 95,
                takeProfit: 105
            },
            candle: {
                time: 1,
                open: 100,
                high: 106,
                low: 94,
                close: 107
            },
            ambiguousFillRule: "legacy",
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("take_profit");
        expect(result.outcome).toBe("win");
        expect(result.exitPrice).toBe(105);
    });

    it("times out at the maximum holding period", () => {
        const result = evaluateCandleExit({
            position: {
                type: "BUY",
                entryPrice: 100,
                stopLoss: 90,
                takeProfit: 120
            },
            candle: {
                time: 1,
                open: 100,
                high: 102,
                low: 98,
                close: 101
            },
            candlesSinceOpen: 60,
            maxHoldCandles: 60,
            assetClass: "crypto",
            costs: zeroCosts
        });

        expect(result.closeReason).toBe("timeout");
        expect(result.outcome).toBe("win");
        expect(result.exitPrice).toBe(101);
    });

    it("creates a BUY entry fill", () => {
        const result = createEntryFill({
            signal: { type: "BUY", price: 100 },
            assetClass: "crypto",
            costs: zeroCosts
        });
        expect(result).toBe(100);
    });

    it("creates a SELL entry fill", () => {
        const result = createEntryFill({
            signal: { type: "SELL", price: 100 },
            assetClass: "crypto",
            costs: zeroCosts
        });
        expect(result).toBe(100);
    });
});
