import { describe, it, expect } from "vitest";
import { shouldOpen, checkExit } from "../scripts/scheduler/virtualTrades.js";

describe("shouldOpen", () => {
    it("opens on BUY/SELL when ready", () => {
        expect(shouldOpen({ type: "BUY", ready: true })).toBe(true);
        expect(shouldOpen({ type: "SELL" })).toBe(true); // ready undefined -> not explicitly false
    });

    it("does not open on WAIT or when explicitly not ready", () => {
        expect(shouldOpen({ type: "WAIT" })).toBe(false);
        expect(shouldOpen({ type: "BUY", ready: false })).toBe(false);
    });
});

describe("checkExit - intrabar SL/TP detection", () => {
    // This is the fix flagged in the original review: checking exits
    // against just the close price misses a candle that traded through
    // TP/SL intrabar even though its close never got there.
    const longTrade = { type: "BUY", entryPrice: 100, stopLoss: 95, takeProfit: 105 };

    it("detects a take-profit hit via the candle's high even if close never got there", () => {
        const candle = { high: 106, low: 99, close: 101 }; // close is below TP, but high traded through it
        const result = checkExit(longTrade, candle, 1, 60);
        expect(result).not.toBeNull();
        expect(result.outcome).toBe("win");
        expect(result.closeReason).toBe("take_profit");
    });

    it("detects a stop-loss hit via the candle's low even if close never got there", () => {
        const candle = { high: 101, low: 94, close: 99 }; // close above SL, but low traded through it
        const result = checkExit(longTrade, candle, 1, 60);
        expect(result).not.toBeNull();
        expect(result.outcome).toBe("loss");
        expect(result.closeReason).toBe("stop_loss");
    });

    it("stays open when the candle's range never reaches either level", () => {
        const candle = { high: 102, low: 98, close: 100.5 };
        expect(checkExit(longTrade, candle, 1, 60)).toBeNull();
    });

    it("mirrors the logic correctly for a SHORT position (SL/TP flipped)", () => {
        const shortTrade = { type: "SELL", entryPrice: 100, stopLoss: 105, takeProfit: 95 };
        const tpCandle = { high: 101, low: 94, close: 99 }; // low traded through TP for a short
        const result = checkExit(shortTrade, tpCandle, 1, 60);
        expect(result.outcome).toBe("win");
        expect(result.closeReason).toBe("take_profit");
    });

    it("resolves an ambiguous same-candle TP+SL hit conservatively by default (stop wins)", () => {
        const candle = { high: 106, low: 94, close: 100 }; // both TP(105) and SL(95) inside range
        const result = checkExit(longTrade, candle, 1, 60, "conservative");
        expect(result.outcome).toBe("loss");
        expect(result.closeReason).toBe("stop_loss");
    });

    it("resolves an ambiguous same-candle TP+SL hit optimistically when configured (target wins)", () => {
        const candle = { high: 106, low: 94, close: 100 };
        const result = checkExit(longTrade, candle, 1, 60, "optimistic");
        expect(result.outcome).toBe("win");
        expect(result.closeReason).toBe("take_profit");
    });

    it("times out and settles at the close price once maxHoldCandles is reached", () => {
        const candle = { high: 101, low: 99, close: 100.5 }; // no TP/SL hit
        const result = checkExit(longTrade, candle, 60, 60);
        expect(result).not.toBeNull();
        expect(result.closeReason).toBe("timeout");
        // close (100.5) > entry (100) for a long -> should be a win
        expect(result.outcome).toBe("win");
    });

    it("does not exit before maxHoldCandles if nothing else triggered", () => {
        const candle = { high: 101, low: 99, close: 100.5 };
        expect(checkExit(longTrade, candle, 59, 60)).toBeNull();
    });

    it("applies execution costs to the exit fill price, not just the raw candle levels", () => {
        // TP hit exactly at the level - filled exit price should differ
        // slightly from the raw takeProfit level once costs are applied.
        const candle = { high: 106, low: 99, close: 101 };
        const result = checkExit(longTrade, candle, 1, 60, "conservative", "crypto");
        expect(result.exitPrice).not.toBe(longTrade.takeProfit);
    });
});
