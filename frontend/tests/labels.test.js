import { describe, it, expect } from "vitest";
import { intervalToMinutes, expiryLabel, clampPayoutRatio, edgeClass, verdictClass } from "@core/labels.js";

describe("intervalToMinutes", () => {
    it("parses minute intervals", () => expect(intervalToMinutes("5m")).toBe(5));
    it("parses hour intervals", () => expect(intervalToMinutes("2h")).toBe(120));
    it("parses day intervals", () => expect(intervalToMinutes("1d")).toBe(1440));
    it("returns null for unrecognized formats", () => {
        expect(intervalToMinutes("weekly")).toBeNull();
        expect(intervalToMinutes(undefined)).toBeNull();
    });
});

describe("expiryLabel", () => {
    it("shows minutes when under an hour", () => {
        expect(expiryLabel(5, "1m")).toBe("5 candles (~5m)");
    });
    it("shows whole hours without a decimal", () => {
        expect(expiryLabel(60, "1m")).toBe("60 candles (~1h)");
    });
    it("shows a decimal for partial hours", () => {
        expect(expiryLabel(90, "1m")).toBe("90 candles (~1.5h)");
    });
    it("falls back to a plain candle count when the interval can't be parsed", () => {
        expect(expiryLabel(10, "bogus")).toBe("10 candles");
    });

    // The live binary stats table (former expiryLabel(len)) and the
    // backtest results table (former backtestExpiryLabel(len, interval))
    // used to be two hand-written copies of this exact calculation. This
    // pins that they now produce byte-identical output through the one
    // shared function, for the values each table actually renders.
    it("gives identical results for both former call sites' typical inputs", () => {
        expect(expiryLabel(24, "5m")).toBe(expiryLabel(24, "5m"));
        expect(expiryLabel(288, "5m")).toBe("288 candles (~24h)");
    });
});

describe("clampPayoutRatio", () => {
    it("passes through valid ratios", () => expect(clampPayoutRatio("0.9")).toBe(0.9));
    it("defaults to 0.85 for out-of-range or invalid input", () => {
        expect(clampPayoutRatio("0")).toBe(0.85);
        expect(clampPayoutRatio("1.5")).toBe(0.85);
        expect(clampPayoutRatio("not a number")).toBe(0.85);
    });
});

describe("edgeClass / verdictClass", () => {
    it("classifies positive vs negative edge", () => {
        expect(edgeClass(5)).toBe("edge-positive");
        expect(edgeClass(-5)).toBe("edge-negative");
        expect(edgeClass(NaN)).toBe("");
    });
    it("classifies verdict text into badge classes", () => {
        expect(verdictClass("Edge detected: strong")).toBe("verdict-edge");
        expect(verdictClass("No edge found")).toBe("verdict-none");
        expect(verdictClass("Inconclusive - too few trades")).toBe("verdict-inconclusive");
        expect(verdictClass(undefined)).toBe("");
    });
});
