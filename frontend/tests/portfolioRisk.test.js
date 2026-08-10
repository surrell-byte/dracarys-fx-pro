import { describe, it, expect } from "vitest";
import { evaluatePortfolioRisk } from "../scripts/scheduler/portfolioRisk.js";

function makeOpenTrade(symbol, type) {
    return { symbol, type };
}

describe("evaluatePortfolioRisk", () => {
    it("allows a trade when the portfolio is empty", () => {
        const result = evaluatePortfolioRisk({ symbol: "BTCUSDT", type: "BUY" }, []);
        expect(result.allowed).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it("blocks once maxConcurrentPositions is reached, regardless of symbol/direction", () => {
        const open = Array(20).fill(null).map((_, i) => makeOpenTrade(`SYM${i}`, "BUY"));
        const result = evaluatePortfolioRisk({ symbol: "EURUSD", type: "SELL" }, open, [], { maxConcurrentPositions: 20 });
        expect(result.allowed).toBe(false);
        expect(result.reasons.some((r) => r.includes("max concurrent"))).toBe(true);
    });

    it("blocks stacking too many positions on the same symbol even under the concurrent cap", () => {
        const open = Array(4).fill(null).map(() => makeOpenTrade("BTCUSDT", "BUY"));
        const result = evaluatePortfolioRisk(
            { symbol: "BTCUSDT", type: "SELL" },
            open,
            [],
            { maxConcurrentPositions: 20, maxPositionsPerSymbol: 4 }
        );
        expect(result.allowed).toBe(false);
        expect(result.reasons.some((r) => r.includes("BTCUSDT"))).toBe(true);
    });

    it("blocks when too many positions share the same direction (correlated-bet protection)", () => {
        // This is the exact scenario flagged in the original review: 14
        // strategies all independently saying BUY isn't 14 independent
        // confirmations, it's one directional bet repeated.
        const open = Array(12).fill(null).map((_, i) => makeOpenTrade(`SYM${i}`, "BUY"));
        const result = evaluatePortfolioRisk(
            { symbol: "NEWSYMBOL", type: "BUY" },
            open,
            [],
            { maxConcurrentPositions: 50, maxPositionsPerSymbol: 50, maxPositionsPerDirection: 12 }
        );
        expect(result.allowed).toBe(false);
        expect(result.reasons.some((r) => r.includes("BUY positions"))).toBe(true);
    });

    it("does not block on direction when the candidate is the opposite side", () => {
        const open = Array(12).fill(null).map((_, i) => makeOpenTrade(`SYM${i}`, "BUY"));
        const result = evaluatePortfolioRisk(
            { symbol: "NEWSYMBOL", type: "SELL" },
            open,
            [],
            { maxConcurrentPositions: 50, maxPositionsPerSymbol: 50, maxPositionsPerDirection: 12 }
        );
        expect(result.allowed).toBe(true);
    });

    it("blocks new trades once the daily loss limit is breached", () => {
        const closedToday = [{ pnl_pct: -3 }, { pnl_pct: -2.5 }];
        const result = evaluatePortfolioRisk(
            { symbol: "BTCUSDT", type: "BUY" },
            [],
            closedToday,
            { maxDailyLossPct: -5 }
        );
        expect(result.allowed).toBe(false);
        expect(result.reasons.some((r) => r.includes("daily loss"))).toBe(true);
    });

    it("does not apply a daily loss check when maxDailyLossPct is null (default)", () => {
        const closedToday = [{ pnl_pct: -50 }];
        const result = evaluatePortfolioRisk({ symbol: "BTCUSDT", type: "BUY" }, [], closedToday);
        expect(result.allowed).toBe(true);
    });

    it("can return multiple simultaneous reasons", () => {
        const open = Array(20).fill(null).map(() => makeOpenTrade("BTCUSDT", "BUY"));
        const result = evaluatePortfolioRisk(
            { symbol: "BTCUSDT", type: "BUY" },
            open,
            [],
            { maxConcurrentPositions: 20, maxPositionsPerSymbol: 4, maxPositionsPerDirection: 4 }
        );
        expect(result.reasons.length).toBeGreaterThan(1);
    });
});
