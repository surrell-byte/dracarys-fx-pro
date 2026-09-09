import { describe, expect, it } from "vitest";
import { evaluateEntryFilters } from "@risk/entryFilters.js";

const signal = (overrides = {}) => ({
    type: "BUY",
    ready: true,
    confidence: 80,
    quality: "High",
    price: 100,
    regime: { primary: "TRENDING" },
    risk: { takeProfit: 101 },
    ...overrides
});

describe("entry filters", () => {
    it("accepts a sufficiently confident, economical signal", () => {
        expect(evaluateEntryFilters(signal(), {
            minConfidence: 70,
            minQuality: "Medium",
            allowedRegimes: ["TRENDING"],
            minTargetToCostRatio: 2,
            estimatedCostPct: 0.25
        }).allowed).toBe(true);
    });

    it("rejects weak confidence and incompatible regimes", () => {
        const result = evaluateEntryFilters(signal({ confidence: 65, regime: { primary: "RANGING" } }), {
            minConfidence: 70,
            allowedRegimes: ["TRENDING"]
        });
        expect(result.allowed).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining([
            "confidence below 70",
            "regime RANGING not allowed"
        ]));
    });

    it("rejects a target that cannot cover estimated costs", () => {
        const result = evaluateEntryFilters(signal(), {
            minTargetToCostRatio: 2,
            estimatedCostPct: 0.6
        });
        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain("target/cost ratio below 2");
    });
});
