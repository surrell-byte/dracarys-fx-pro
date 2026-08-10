import { describe, it, expect } from "vitest";
import { applyEntryCost, applyExitCost, applyFeeToPnl, DEFAULT_EXECUTION_COSTS } from "@analysis/executionCosts.js";

describe("executionCosts", () => {
    const price = 100;

    it("makes a BUY-position entry more expensive than the raw price", () => {
        const filled = applyEntryCost(price, "BUY", "crypto");
        expect(filled).toBeGreaterThan(price);
    });

    it("makes a BUY-position exit worse (lower) than the raw price", () => {
        const filled = applyExitCost(price, "BUY", "crypto");
        expect(filled).toBeLessThan(price);
    });

    it("makes a SELL-position entry worse (lower) than the raw price", () => {
        const filled = applyEntryCost(price, "SELL", "crypto");
        expect(filled).toBeLessThan(price);
    });

    it("makes a SELL-position exit worse (higher) than the raw price", () => {
        const filled = applyExitCost(price, "SELL", "crypto");
        expect(filled).toBeGreaterThan(price);
    });

    it("costs are symmetric in magnitude between BUY and SELL", () => {
        const buyEntryDelta = applyEntryCost(price, "BUY", "crypto") - price;
        const sellEntryDelta = price - applyEntryCost(price, "SELL", "crypto");
        expect(buyEntryDelta).toBeCloseTo(sellEntryDelta, 10);
    });

    it("always reduces PnL by the round-trip fee, regardless of sign", () => {
        const feePct = DEFAULT_EXECUTION_COSTS.crypto.feePct * 100;
        expect(applyFeeToPnl(10, "crypto")).toBeCloseTo(10 - feePct, 8);
        expect(applyFeeToPnl(-10, "crypto")).toBeCloseTo(-10 - feePct, 8);
        expect(applyFeeToPnl(0, "crypto")).toBeCloseTo(-feePct, 8);
    });

    it("forex has zero fee by default but non-zero spread/slippage", () => {
        expect(applyFeeToPnl(5, "forex")).toBeCloseTo(5, 8);
        expect(applyEntryCost(price, "BUY", "forex")).toBeGreaterThan(price);
    });

    it("falls back to the crypto cost table for an unknown asset class", () => {
        const known = applyEntryCost(price, "BUY", "crypto");
        const unknown = applyEntryCost(price, "BUY", "totally-made-up-asset-class");
        expect(unknown).toBeCloseTo(known, 10);
    });

    it("a custom costs table overrides the default", () => {
        const customCosts = { crypto: { spreadPct: 0.01, slippagePct: 0, feePct: 0 } };
        const filled = applyEntryCost(price, "BUY", "crypto", customCosts);
        // adverse = spreadPct/2 = 0.005 -> price * 1.005
        expect(filled).toBeCloseTo(price * 1.005, 8);
    });
});
