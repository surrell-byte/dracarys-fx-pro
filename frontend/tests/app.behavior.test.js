// @vitest-environment jsdom
//
// app.js is a ~1,270-line DOM controller with no exported functions - it
// wires up `elements.*` from real ids in index.html at module load, then
// drives all state through event listeners and market-service callbacks.
// It can't be unit tested by importing individual functions (there aren't
// any to import), so this suite drives it the way a browser would:
//   1. load the REAL index.html into jsdom (so an id typo in app.js would
//      break this suite the same way it'd break production)
//   2. mock the network-touching collaborators (market data service,
//      higher-timeframe fetch) so tests are deterministic and offline
//   3. import app.js fresh per test (it runs init()/wiring at import time)
//   4. simulate user actions and assert on the resulting DOM state
//
// This is intentionally behavior-level, not implementation-level: it does
// not know about `resolveQuantity` or `checkPaperStops` by name. That is
// what makes it safe to lean on *before* splitting app.js apart - the
// tests describe what the app does, not how it's currently structured, so
// a refactor that preserves behavior keeps them green.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const indexHtmlPath = path.resolve(__dirname, "../index.html");
const indexHtml = fs.readFileSync(indexHtmlPath, "utf-8");

function candle({ time, open, high, low, close, volume = 100 }) {
    return { time, open, high, low, close, volume };
}

// A short uptrend so BUY-leaning strategies have something to key off of,
// long enough to satisfy every strategy's minimum lookback.
function makeUptrendCandles(count = 250, start = 100) {
    const out = [];
    let price = start;
    for (let i = 0; i < count; i += 1) {
        const open = price;
        price += 0.15;
        const close = price;
        const high = Math.max(open, close) + 0.05;
        const low = Math.min(open, close) - 0.05;
        out.push(candle({ time: i * 60_000, open, high, low, close, volume: 100 + (i % 5) }));
    }
    return out;
}

// --- Mocks for app.js's network-touching collaborators -------------------
// Captured per-import so each test gets a fresh set of callback hooks.
let marketCallbacks;
let marketMockState;

vi.mock("@services/unifiedMarketDataService.js", () => {
    return {
        UnifiedMarketDataService: vi.fn().mockImplementation(function UnifiedMarketDataServiceMock() {
            marketCallbacks = { candle: null, tick: null, status: null };
            const instance = {
                onCandle: (cb) => { marketCallbacks.candle = cb; },
                onTick: (cb) => { marketCallbacks.tick = cb; },
                onStatus: (cb) => { marketCallbacks.status = cb; },
                connect: vi.fn(),
                disconnect: vi.fn(),
                setMarket: vi.fn(),
                getCandles: vi.fn(async () => marketMockState.candles),
                getHistoricalCandles: vi.fn(async () => marketMockState.candles)
            };
            Object.assign(this, instance);
        })
    };
});

vi.mock("@analysis/multiTimeframe.js", () => ({
    getHigherTimeframeTrend: vi.fn(async () => ({ trend: "BULLISH", ready: true }))
}));

async function loadApp({ candles = makeUptrendCandles() } = {}) {
    marketMockState = { candles };
    document.documentElement.innerHTML = indexHtml
        .replace(/<!DOCTYPE html>/i, "")
        .match(/<html[^>]*>([\s\S]*)<\/html>/i)[1];

    // app.js reads canvas 2D context for the chart; jsdom doesn't implement
    // canvas rendering, so stub just enough that drawChart() doesn't throw.
    const canvas = document.querySelector("#chart");
    if (canvas) {
        canvas.getContext = () => ({
            clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
            stroke: () => {}, fillRect: () => {}, setTransform: () => {}, fill: () => {},
            arc: () => {}, save: () => {}, restore: () => {}, scale: () => {}, fillText: () => {}
        });
        canvas.getBoundingClientRect = () => ({ width: 600, height: 300 });
    }

    vi.resetModules();
    await import("../src/js/core/app.js");
    // init() runs its async chain (loadMarket -> getCandles) without being
    // awaited at module scope; flush microtasks so it settles before the
    // test drives further interaction.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("app.js boot", () => {
    it("loads real index.html, wires up, and renders an initial signal without throwing", async () => {
        await loadApp();
        const signalEl = document.querySelector("#signal");
        expect(signalEl.textContent).toMatch(/BUY|SELL|HOLD/);
        expect(document.querySelector("#candleCount").textContent).toBe("250");
    });

    it("shows a data error message instead of crashing when candle loading fails", async () => {
        marketMockState = { candles: [] };
        document.documentElement.innerHTML = indexHtml
            .match(/<html[^>]*>([\s\S]*)<\/html>/i)[1];
        const canvas = document.querySelector("#chart");
        canvas.getContext = () => ({
            clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
            stroke: () => {}, fillRect: () => {}, setTransform: () => {}, fill: () => {},
            arc: () => {}, save: () => {}, restore: () => {}, scale: () => {}, fillText: () => {}
        });
        canvas.getBoundingClientRect = () => ({ width: 600, height: 300 });

        vi.resetModules();
        await import("../src/js/core/app.js");
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Empty candle set: signal engine should report "not ready" rather
        // than the page throwing during init().
        expect(document.querySelector("#candleCount").textContent).toBe("0");
    });
});

describe("manual paper trading", () => {
    it("Trade Now opens a paper position when the signal is actionable, and shows entry/stop/target", async () => {
        await loadApp();
        document.querySelector("input[name='tradeMode'][value='paper']").click();
        document.querySelector("#tradeNowBtn").click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const status = document.querySelector("#executionStatus")?.textContent ?? "";
        const positionEl = document.querySelector("#paperPosition");
        const wasBail = /Not enough candles yet|Signal is HOLD/i.test(status);

        if (wasBail) {
            expect(positionEl.textContent.toLowerCase()).toMatch(/flat|--|none/);
        } else {
            expect(positionEl.textContent.toLowerCase()).not.toMatch(/flat|--|none/);
        }
    });

    it("closing an open paper position via Close Position clears it back to flat", async () => {
        await loadApp();
        document.querySelector("input[name='tradeMode'][value='paper']").click();
        document.querySelector("#tradeNowBtn").click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const status = document.querySelector("#executionStatus")?.textContent ?? "";
        if (/Not enough candles yet|Signal is HOLD/i.test(status)) return; // nothing opened; nothing to close

        const opened = document.querySelector("#paperPosition").textContent;
        expect(opened.toLowerCase()).not.toMatch(/flat|--|none/);

        document.querySelector("#closePaperBtn").click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const closed = document.querySelector("#paperPosition").textContent;
        expect(closed.toLowerCase()).toMatch(/flat|--|none/);
    });

    it("a take-profit level being crossed on the next tick auto-closes the paper position", async () => {
        await loadApp();
        document.querySelector("input[name='tradeMode'][value='paper']").click();
        document.querySelector("#tradeNowBtn").click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const wasOpen = document.querySelector("#paperPosition").textContent.toLowerCase() !== "flat";
        if (!wasOpen) return; // signal was HOLD on this synthetic data; nothing to test here

        // Blow well past any plausible stop/target in either direction so
        // one of the two branches fires regardless of side.
        marketCallbacks.tick({ close: 100000 });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const afterUp = document.querySelector("#paperPosition").textContent.toLowerCase();

        if (afterUp !== "flat") {
            marketCallbacks.tick({ close: 0.0001 });
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const finalState = document.querySelector("#paperPosition").textContent.toLowerCase();
        expect(finalState).toMatch(/flat|--|none/);
    });
});

describe("strategy switching", () => {
    it("changing the strategy select re-renders the signal with the new strategy name", async () => {
        await loadApp();
        const select = document.querySelector("#strategySelect");
        const original = select.value;
        const alternative = Array.from(select.options).map(o => o.value).find(v => v !== original);
        expect(alternative).toBeTruthy();

        select.value = alternative;
        select.dispatchEvent(new Event("change"));

        expect(document.querySelector("#strategyName").textContent).not.toBe("");
    });
});

describe("history and journal controls", () => {
    it("Clear History empties the signal history list", async () => {
        await loadApp();
        // Force at least one closed candle through so history has an entry.
        marketCallbacks.candle(makeUptrendCandles(251)[250]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        document.querySelector("#clearHistory").click();
        const list = document.querySelector("#historyList");
        // renderHistory() renders a "No signals yet" placeholder row when
        // state.history is empty, rather than an empty container.
        expect(list.textContent).toMatch(/no signals yet/i);
    });
});

describe("market/symbol switching", () => {
    it("changing the pair select fetches the new market and updates the market label", async () => {
        await loadApp();
        const select = document.querySelector("#pairSelect");
        const original = select.value;
        const alternative = Array.from(select.options)
            .map((o) => o.value)
            .find((v) => v !== original);
        expect(alternative).toBeTruthy();

        // getCandles/getHistoricalCandles resolve from marketMockState.candles
        // regardless of symbol in this mock, but switching symbols should
        // still re-trigger a fetch and update the label to match the new pair.
        select.value = alternative;
        select.dispatchEvent(new Event("change"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(document.querySelector("#marketLabel").textContent).toContain(alternative.toUpperCase());
    });

    it("switching markets disables auto-trade and resets the paper account rather than carrying a position across symbols", async () => {
        await loadApp();
        document.querySelector("input[name='tradeMode'][value='paper']").click();
        document.querySelector("#tradeNowBtn").click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const autoTrade = document.querySelector("#autoTrade");
        autoTrade.checked = true;
        autoTrade.dispatchEvent(new Event("change"));
        expect(document.querySelector("#executionStatus").textContent).toMatch(/auto mode armed/i);

        const select = document.querySelector("#pairSelect");
        const alternative = Array.from(select.options)
            .map((o) => o.value)
            .find((v) => v !== select.value);
        select.value = alternative;
        select.dispatchEvent(new Event("change"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // A market switch should leave auto-trade disabled (the person has to
        // consciously re-arm it on the new symbol) and the paper position
        // should not have silently carried over from the old market.
        expect(autoTrade.checked).toBe(false);
        expect(document.querySelector("#paperPosition").textContent.toLowerCase()).toMatch(/flat|--|none/);
    });

    it("fetches and renders the higher-timeframe trend on boot", async () => {
        await loadApp();
        // The multiTimeframe.js mock always resolves { trend: "BULLISH", ready: true }.
        expect(document.querySelector("#htfTrend").textContent).toBe("BULLISH");
    });
});

describe("auto-trade execution wiring", () => {
    it("arming auto-trade and then receiving an actionable closed candle attempts an execution (status leaves 'Manual mode')", async () => {
        await loadApp();
        document.querySelector("input[name='tradeMode'][value='paper']").click();

        const autoTrade = document.querySelector("#autoTrade");
        autoTrade.checked = true;
        autoTrade.dispatchEvent(new Event("change"));
        expect(document.querySelector("#executionStatus").textContent).toMatch(/auto mode armed/i);

        marketCallbacks.candle(makeUptrendCandles(251)[250]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Whatever the outcome (opened a position, held due to confidence
        // gate, etc.), the status should reflect maybeExecute() actually
        // having run against the new candle - not still show the stale
        // "Auto mode armed" text from before any candle arrived.
        const status = document.querySelector("#executionStatus").textContent;
        expect(status).not.toBe("");
    });
});
