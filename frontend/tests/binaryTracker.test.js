import { describe, it, expect, beforeEach } from "vitest";
import { BinaryOutcomeTracker } from "@analysis/binaryTracker.js";

// getBinaryStats/getCalibrationCurve are pure query methods over
// `resolved` - populate that array directly rather than driving the full
// onCandle() pipeline, so these tests aren't coupled to signalEngine
// internals or real candle data.
function makeTracker() {
    const tracker = new BinaryOutcomeTracker(["balanced", "breakout"]);
    tracker.resolved = [];
    tracker.pending = [];
    return tracker;
}

describe("BinaryOutcomeTracker - symbol scoping (Phase 5 fix)", () => {
    let tracker;

    beforeEach(() => {
        tracker = makeTracker();
        tracker.currentSymbol = "BTCUSDT";
        // 20 resolved wins for BTCUSDT
        for (let i = 0; i < 20; i += 1) {
            tracker.resolved.push({ strategy: "balanced", label: "Balanced", expiryLength: 5, win: true, symbol: "BTCUSDT", confidence: 70 });
        }
        // 20 resolved losses for EURUSD under the SAME strategy/expiry
        for (let i = 0; i < 20; i += 1) {
            tracker.resolved.push({ strategy: "balanced", label: "Balanced", expiryLength: 5, win: false, symbol: "EURUSD", confidence: 70 });
        }
    });

    it("scopes getBinaryStats to the current symbol by default (doesn't pool across symbols)", () => {
        const stats = tracker.getBinaryStats(20, 0.85);
        const row = stats.find((r) => r.strategy === "balanced" && r.expiryLength === 5);
        expect(row.trades).toBe(20);
        expect(row.winRate).toBeCloseTo(100, 5); // only BTCUSDT's 20 wins counted
    });

    it("reflects the newly set symbol after setSymbol switches context", () => {
        tracker.setSymbol("EURUSD", "forex");
        const stats = tracker.getBinaryStats(20, 0.85);
        const row = stats.find((r) => r.strategy === "balanced" && r.expiryLength === 5);
        expect(row.trades).toBe(20);
        expect(row.winRate).toBeCloseTo(0, 5); // only EURUSD's 20 losses counted
    });

    it("can still pool across all symbols when explicitly requested", () => {
        const stats = tracker.getBinaryStats(20, 0.85, { allSymbols: true });
        const row = stats.find((r) => r.strategy === "balanced" && r.expiryLength === 5);
        expect(row.trades).toBe(40);
        expect(row.winRate).toBeCloseTo(50, 5); // 20 wins + 20 losses pooled
    });
});

describe("BinaryOutcomeTracker - calibration curve", () => {
    it("reports actual win rate per confidence bucket", () => {
        const tracker = makeTracker();
        // 65-70% bucket: 20 trades, 15 wins -> 75% actual win rate
        for (let i = 0; i < 15; i += 1) tracker.resolved.push({ strategy: "balanced", win: true, symbol: "BTCUSDT", confidence: 67 });
        for (let i = 0; i < 5; i += 1) tracker.resolved.push({ strategy: "balanced", win: false, symbol: "BTCUSDT", confidence: 67 });

        const curve = tracker.getCalibrationCurve({ minSampleSize: 20 });
        const bucket = curve.find((b) => b.rangeLabel === "65-70%");
        expect(bucket.trades).toBe(20);
        expect(bucket.reliable).toBe(true);
        expect(bucket.actualWinRate).toBeCloseTo(75, 5);
    });

    it("marks under-sampled buckets unreliable with a null win rate", () => {
        const tracker = makeTracker();
        tracker.resolved.push({ strategy: "balanced", win: true, symbol: "BTCUSDT", confidence: 82 });
        const curve = tracker.getCalibrationCurve({ minSampleSize: 20 });
        const bucket = curve.find((b) => b.rangeLabel === "80-85%");
        expect(bucket.trades).toBe(1);
        expect(bucket.reliable).toBe(false);
        expect(bucket.actualWinRate).toBeNull();
    });

    it("ignores resolved trades with no recorded confidence (legacy data)", () => {
        const tracker = makeTracker();
        tracker.resolved.push({ strategy: "balanced", win: true, symbol: "BTCUSDT", confidence: undefined });
        const curve = tracker.getCalibrationCurve({ minSampleSize: 1 });
        const totalTrades = curve.reduce((sum, b) => sum + b.trades, 0);
        expect(totalTrades).toBe(0);
    });

    it("pools across symbols by default (calibration asks a different question than per-symbol performance)", () => {
        const tracker = makeTracker();
        for (let i = 0; i < 10; i += 1) tracker.resolved.push({ strategy: "balanced", win: true, symbol: "BTCUSDT", confidence: 55 });
        for (let i = 0; i < 10; i += 1) tracker.resolved.push({ strategy: "balanced", win: true, symbol: "EURUSD", confidence: 55 });
        const curve = tracker.getCalibrationCurve({ minSampleSize: 20 });
        const bucket = curve.find((b) => b.rangeLabel === "55-60%");
        expect(bucket.trades).toBe(20);
        expect(bucket.reliable).toBe(true);
    });
});
