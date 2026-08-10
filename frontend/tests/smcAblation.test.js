import { describe, it, expect } from "vitest";
import { generateSignal } from "@signals/signalEngine.js";

// Deterministic synthetic candles with a real (not pure-random) trend/
// pullback wave shape, so the AI Confidence Pipeline's pattern/structure/
// SMC modules have something to actually vote on rather than reporting
// "no opinion" for everything - this test only cares whether excluding a
// named module changes the module breakdown, not whether a trade signal
// fires, so it doesn't need a seeded RNG for reproducibility.
function makeTrendingCandles(n) {
    const candles = [];
    let price = 100;
    for (let i = 0; i < n; i += 1) {
        const wave = Math.sin(i / 40) * 3;
        price += wave * 0.15 + Math.sin(i / 3) * 0.3;
        const open = price;
        const close = price + Math.cos(i / 5) * 0.4;
        const high = Math.max(open, close) + 0.3;
        const low = Math.min(open, close) - 0.3;
        candles.push({ time: 1_700_000_000_000 + i * 60_000, open, high, low, close, volume: 120 });
        price = close;
    }
    return candles;
}

const SMC_MODULES = ["orderBlock", "fairValueGap", "liquiditySweep", "breakerBlock", "mitigation"];

describe("generateSignal - excludeVoteModules ablation hook", () => {
    const candles = makeTrendingCandles(300);

    it("includes every SMC module's vote by default (no behavior change for normal callers)", () => {
        const signal = generateSignal(candles, "aiConfidence", { higherTrend: "NEUTRAL" });
        const names = signal.moduleBreakdown.map((m) => m.name);
        SMC_MODULES.forEach((m) => expect(names).toContain(m));
    });

    it("removes exactly the named module from the breakdown when excluded", () => {
        const signal = generateSignal(candles, "aiConfidence", {
            higherTrend: "NEUTRAL",
            excludeVoteModules: ["orderBlock"]
        });
        const names = signal.moduleBreakdown.map((m) => m.name);
        expect(names).not.toContain("orderBlock");
        // Every other SMC module should still be present - this is a
        // targeted exclusion, not a blanket "drop all SMC" behavior.
        SMC_MODULES.filter((m) => m !== "orderBlock").forEach((m) => expect(names).toContain(m));
    });

    it("removes all SMC modules at once when all are listed", () => {
        const signal = generateSignal(candles, "aiConfidence", {
            higherTrend: "NEUTRAL",
            excludeVoteModules: SMC_MODULES
        });
        const names = signal.moduleBreakdown.map((m) => m.name);
        SMC_MODULES.forEach((m) => expect(names).not.toContain(m));
        // Non-SMC modules (ema, rsi, macd, ...) should be unaffected.
        expect(names).toContain("ema");
        expect(names).toContain("rsi");
    });

    it("does not affect non-aiConfidence strategies at all (option is a no-op for them)", () => {
        const withExclusion = generateSignal(candles, "balanced", {
            higherTrend: "NEUTRAL",
            excludeVoteModules: SMC_MODULES
        });
        const withoutExclusion = generateSignal(candles, "balanced", { higherTrend: "NEUTRAL" });
        // "balanced" doesn't use scoreAiConfidencePipeline at all, so its
        // score/confidence/reason should be identical either way.
        expect(withExclusion.confidence).toBe(withoutExclusion.confidence);
        expect(withExclusion.type).toBe(withoutExclusion.type);
    });

    it("an unknown module name in excludeVoteModules is silently ignored (no crash)", () => {
        expect(() => generateSignal(candles, "aiConfidence", {
            higherTrend: "NEUTRAL",
            excludeVoteModules: ["not-a-real-module"]
        })).not.toThrow();
    });
});
