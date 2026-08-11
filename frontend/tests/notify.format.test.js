import { describe, it, expect } from "vitest";
import { formatSignalMessage, formatDailySummaryMessage } from "../scripts/scheduler/notify.js";

// Covers formatSignalMessage/formatDailySummaryMessage, which notify.test.js
// doesn't exercise. Added alongside the expiry-estimate patch so a future
// change to signal.expiry's shape (e.g. renaming .label, or estimateExpiry
// returning null instead of a fixed shape) fails a test instead of silently
// changing what gets posted to Discord.

const baseSignal = {
    type: "BUY",
    price: 67046.27,
    strategy: "Trend Follow",
    confidence: 82,
    quality: "High",
    reason: "EMA cross with volume confirmation",
    risk: {
        stopLoss: 66500,
        takeProfit: 68200,
        rrLabel: "1:1.0 / 1:2.5"
    },
    expiry: { label: "15 min", minutes: 15, method: "data" }
};

describe("formatSignalMessage - expiry line", () => {
    it("includes the suggested expiry when signal.expiry.label is set", () => {
        const msg = formatSignalMessage(baseSignal, "BTC/USDT");
        expect(msg).toContain("Suggested expiry  15 min");
    });

    it("omits the expiry line entirely when signal.expiry is null (e.g. HOLD signals)", () => {
        const msg = formatSignalMessage({ ...baseSignal, expiry: null }, "BTC/USDT");
        expect(msg).not.toContain("Suggested expiry");
    });

    it("omits the expiry line when expiry.label is falsy but the expiry object exists", () => {
        const msg = formatSignalMessage(
            { ...baseSignal, expiry: { label: "", minutes: 0, method: "fallback" } },
            "BTC/USDT"
        );
        expect(msg).not.toContain("Suggested expiry");
    });

    it("places the expiry line after R:R and doesn't corrupt the rest of the message", () => {
        const msg = formatSignalMessage(baseSignal, "BTC/USDT");
        const lines = msg.split("\n");
        const expiryLineIndex = lines.findIndex(l => l.includes("Suggested expiry"));
        const rrLineIndex = lines.findIndex(l => l.includes("R:R"));

        expect(expiryLineIndex).toBeGreaterThan(rrLineIndex);
        expect(msg).toContain("EMA cross with volume confirmation");
    });
});

describe("formatDailySummaryMessage - unaffected by the expiry patch", () => {
    it("still formats correctly (no expiry field exists on daily summary data)", () => {
        const data = {
            dateLabel: "2026-08-11",
            totalTrades: 12,
            winRate: 66.7,
            totalPnlPct: 4.21,
            profitFactor: 1.85,
            bestStrategy: { key: "Trend Follow", winRate: 80 },
            worstStrategy: { key: "Scalping", winRate: 40 },
            openCount: 2
        };
        const msg = formatDailySummaryMessage(data);

        expect(msg).toContain("Trades: 12");
        expect(msg).toContain("Trend Follow (80%)");
        expect(msg).not.toContain("expiry");
    });
});
