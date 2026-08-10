import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    resolveQuantity,
    isCoolingDown,
    calculatePositionPnl,
    getPaperPnl,
    executePaperTrade,
    checkPaperStops,
    closePaperPositionManually,
    resetPaperAccount
} from "@core/paperTrading.js";

function freshPaper(overrides = {}) {
    return {
        side: null, entry: null, quantity: 0,
        stopLoss: null, takeProfit: null,
        realizedPnl: 0, demoId: null,
        ...overrides
    };
}

let openPosition, closePosition;
beforeEach(() => {
    openPosition = vi.fn(() => ({ id: "pos-1" }));
    closePosition = vi.fn();
});

describe("resolveQuantity", () => {
    it("uses the fixed quantity when risk sizing is off", () => {
        const qty = resolveQuantity({ risk: { stopDistance: 2 } }, { useRiskSizing: false, quantity: 0.5 });
        expect(qty).toBe(0.5);
    });

    it("sizes from account risk % and ATR stop distance", () => {
        const qty = resolveQuantity(
            { risk: { stopDistance: 10 } },
            { useRiskSizing: true, accountSize: 10000, riskPercent: 1, quantity: 0.5 }
        );
        expect(qty).toBe(10); // $100 risk / $10 stop distance
    });

    it("falls back to fixed quantity when there is no stop distance yet", () => {
        const qty = resolveQuantity(
            { risk: {} },
            { useRiskSizing: true, accountSize: 10000, riskPercent: 1, quantity: 0.5 }
        );
        expect(qty).toBe(0.5);
    });
});

describe("isCoolingDown", () => {
    it("is true immediately after a trade", () => {
        expect(isCoolingDown(Date.now(), 60)).toBe(true);
    });
    it("is false once the cooldown window has passed", () => {
        expect(isCoolingDown(Date.now() - 61_000, 60)).toBe(false);
    });
});

describe("calculatePositionPnl / getPaperPnl", () => {
    it("computes long PnL as (mark - entry) * quantity", () => {
        const paper = freshPaper({ side: "long", entry: 100, quantity: 2 });
        expect(calculatePositionPnl(paper, 105)).toBe(10);
    });
    it("computes short PnL as (entry - mark) * quantity", () => {
        const paper = freshPaper({ side: "short", entry: 100, quantity: 2 });
        expect(calculatePositionPnl(paper, 95)).toBe(10);
    });
    it("getPaperPnl adds unrealized to realized", () => {
        const paper = freshPaper({ side: "long", entry: 100, quantity: 1, realizedPnl: 5 });
        expect(getPaperPnl(paper, 110)).toBe(15);
    });
    it("getPaperPnl returns just realized when flat", () => {
        const paper = freshPaper({ realizedPnl: 42 });
        expect(getPaperPnl(paper, 999)).toBe(42);
    });
});

describe("executePaperTrade", () => {
    it("opens a new position and records the demo id", () => {
        const paper = freshPaper();
        const signal = { type: "BUY", price: 100, confidence: 70, risk: { stopLoss: 95, takeProfit: 110 } };
        const result = executePaperTrade(paper, signal, 1, {
            symbol: "btcusdt", strategyLabel: "Balanced", openPosition, closePosition
        });

        expect(paper.side).toBe("long");
        expect(paper.entry).toBe(100);
        expect(paper.demoId).toBe("pos-1");
        expect(openPosition).toHaveBeenCalledTimes(1);
        expect(result.action).toMatch(/opened long/);
    });

    it("flips an open short into a long on an opposite signal, realizing PnL", () => {
        const paper = freshPaper({ side: "short", entry: 100, quantity: 1, demoId: "pos-old" });
        const signal = { type: "BUY", price: 90, confidence: 70, risk: {} };
        const result = executePaperTrade(paper, signal, 1, {
            symbol: "btcusdt", strategyLabel: "Balanced", openPosition, closePosition
        });

        expect(closePosition).toHaveBeenCalledWith("pos-old", 90, expect.stringContaining("Flipped"));
        expect(paper.realizedPnl).toBe(10); // short 100 -> 90 on qty 1
        expect(paper.side).toBe("long");
        expect(result.action).toMatch(/Paper closed short; opened long/);
    });

    it("does nothing beyond a hold when the signal repeats the current side", () => {
        const paper = freshPaper({ side: "long", entry: 100, quantity: 1, demoId: "pos-1" });
        const signal = { type: "BUY", price: 105, confidence: 70, risk: {} };
        const result = executePaperTrade(paper, signal, 1, {
            symbol: "btcusdt", strategyLabel: "Balanced", openPosition, closePosition
        });
        expect(openPosition).not.toHaveBeenCalled();
        expect(result.action).toBe("Paper hold");
    });
});

describe("checkPaperStops", () => {
    it("closes a long on stop-loss breach and reports pnl", () => {
        const paper = freshPaper({ side: "long", entry: 100, quantity: 2, stopLoss: 95, takeProfit: 110, demoId: "pos-1" });
        const outcome = checkPaperStops(paper, 94, { closePosition });
        expect(outcome.label).toBe("Stop-loss hit");
        expect(outcome.pnl).toBe(-12); // (94-100)*2
        expect(paper.side).toBeNull();
        expect(closePosition).toHaveBeenCalledWith("pos-1", 94, "Stop-loss hit");
    });

    it("closes a long on take-profit breach", () => {
        const paper = freshPaper({ side: "long", entry: 100, quantity: 1, stopLoss: 95, takeProfit: 110, demoId: "pos-1" });
        const outcome = checkPaperStops(paper, 111, { closePosition });
        expect(outcome.label).toBe("Take-profit hit");
    });

    it("returns null when nothing is open", () => {
        expect(checkPaperStops(freshPaper(), 100, { closePosition })).toBeNull();
    });

    it("returns null when price is between stop and target", () => {
        const paper = freshPaper({ side: "long", entry: 100, quantity: 1, stopLoss: 95, takeProfit: 110 });
        expect(checkPaperStops(paper, 102, { closePosition })).toBeNull();
    });
});

describe("closePaperPositionManually", () => {
    it("closes whatever is open regardless of stop/target levels", () => {
        const paper = freshPaper({ side: "short", entry: 100, quantity: 1, demoId: "pos-1" });
        const outcome = closePaperPositionManually(paper, 90, { closePosition });
        expect(outcome.pnl).toBe(10);
        expect(outcome.closedSide).toBe("short");
        expect(paper.side).toBeNull();
    });

    it("returns null when there is nothing to close", () => {
        expect(closePaperPositionManually(freshPaper(), 100, { closePosition })).toBeNull();
    });
});

describe("resetPaperAccount", () => {
    it("closes any open demo position and zeroes the account", () => {
        const paper = freshPaper({ side: "long", entry: 100, quantity: 1, realizedPnl: 25, demoId: "pos-1" });
        resetPaperAccount(paper, 105, { closePosition });
        expect(closePosition).toHaveBeenCalledWith("pos-1", 105, "Market switched");
        expect(paper.side).toBeNull();
        expect(paper.realizedPnl).toBe(0);
    });
});
