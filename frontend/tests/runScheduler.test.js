import { describe, it, expect, vi, beforeEach } from "vitest";

// scanSymbol is the scheduler's core per-cycle orchestration: fetch
// candles, resolve open trades against the latest one, generate fresh
// signals, gate them through portfolio risk, and persist/notify. Every
// dependency that touches the network or disk is mocked here so this
// test exercises the *wiring* (call order, what gets passed to what)
// without needing a live exchange or a real SQLite file - db.js and
// candles.js each already have their own dedicated IO tests.

const fetchCandlesMock = vi.fn();
vi.mock("../scripts/scheduler/candles.js", () => ({
    fetchCandles: fetchCandlesMock
}));

const dbMock = {
    getOpenSignals: vi.fn(() => []),
    getAllOpenSignals: vi.fn(() => []),
    getTodaysClosedSignals: vi.fn(() => []),
    incrementCandlesSinceOpen: vi.fn(),
    closeSignal: vi.fn(),
    insertSignal: vi.fn(() => 1)
};
vi.mock("../scripts/scheduler/db.js", () => dbMock);

const shouldOpenMock = vi.fn();
const checkExitMock = vi.fn();
vi.mock("../scripts/scheduler/virtualTrades.js", () => ({
    shouldOpen: shouldOpenMock,
    checkExit: checkExitMock
}));

const evaluatePortfolioRiskMock = vi.fn(() => ({ allowed: true, reasons: [] }));
vi.mock("../scripts/scheduler/portfolioRisk.js", () => ({
    evaluatePortfolioRisk: evaluatePortfolioRiskMock
}));

const createEntryFillMock = vi.fn((options) => options.signal.price);
vi.mock("@analysis/executionSimulator.js", () => ({
    createEntryFill: createEntryFillMock
}));

const sendDiscordMessageMock = vi.fn();
const meetsNotifyThresholdMock = vi.fn(() => false);
vi.mock("../scripts/scheduler/notify.js", () => ({
    sendDiscordMessage: sendDiscordMessageMock,
    meetsNotifyThreshold: meetsNotifyThresholdMock,
    formatSignalMessage: vi.fn(() => "formatted"),
    formatDailySummaryMessage: vi.fn(() => "formatted-summary")
}));

vi.mock("../scripts/scheduler/generateReport.js", () => ({
    generateReport: vi.fn()
}));

// A single fake strategy keeps every test's iteration count predictable
// regardless of how many real strategies signalEngine.js defines.
const generateSignalMock = vi.fn();
vi.mock("@signals/signalEngine.js", () => ({
    generateSignal: generateSignalMock,
    STRATEGIES: { fakeStrategy: { label: "Fake Strategy" } }
}));

vi.mock("node-cron", () => ({
    default: { schedule: vi.fn() }
}));

// Must be set before importing runScheduler.js - see that file's guard
// comment for why this env var exists instead of an argv/import.meta.url
// "am I the entry module" check.
process.env.SCHEDULER_SKIP_AUTOSTART = "1";

const { scanSymbol } = await import("../scripts/scheduler/runScheduler.js");

function makeCandle(overrides = {}) {
    return { time: Date.now() - 120_000, open: 100, high: 101, low: 99, close: 100.5, volume: 10, ...overrides };
}

beforeEach(() => {
    vi.clearAllMocks();
    dbMock.getOpenSignals.mockReturnValue([]);
    dbMock.getAllOpenSignals.mockReturnValue([]);
    dbMock.getTodaysClosedSignals.mockReturnValue([]);
    dbMock.insertSignal.mockReturnValue(1);
    evaluatePortfolioRiskMock.mockReturnValue({ allowed: true, reasons: [] });
    createEntryFillMock.mockImplementation((options) => options.signal.price);
    shouldOpenMock.mockReturnValue(false);
    generateSignalMock.mockReturnValue({ type: "HOLD" });
});

describe("scanSymbol", () => {
    it("does nothing further when candle fetch fails", async () => {
        fetchCandlesMock.mockRejectedValue(new Error("network down"));

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(dbMock.insertSignal).not.toHaveBeenCalled();
        expect(dbMock.getOpenSignals).not.toHaveBeenCalled();
    });

    it("does nothing further when no candles come back", async () => {
        fetchCandlesMock.mockResolvedValue([]);

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(dbMock.insertSignal).not.toHaveBeenCalled();
    });

    it("drops a still-forming last candle before generating a signal", async () => {
        const closedCandle = makeCandle({ time: Date.now() - 5 * 60_000 });
        const formingCandle = makeCandle({ time: Date.now() - 1_000 }); // opened 1s ago, well within a 1m bar
        fetchCandlesMock.mockResolvedValue([closedCandle, formingCandle]);
        shouldOpenMock.mockReturnValue(false);

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(generateSignalMock).toHaveBeenCalledWith([closedCandle], "fakeStrategy");
    });

    it("does not open a new position when a strategy/symbol pair already has one open", async () => {
        fetchCandlesMock.mockResolvedValue([makeCandle({ time: Date.now() - 5 * 60_000 })]);
        shouldOpenMock.mockReturnValue(true);
        generateSignalMock.mockReturnValue({ type: "BUY", price: 100, confidence: 90, quality: "High" });
        dbMock.getOpenSignals.mockReturnValue([{ id: 1 }]);

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(dbMock.insertSignal).not.toHaveBeenCalled();
    });

    it("skips opening a position that the portfolio risk gate rejects", async () => {
        fetchCandlesMock.mockResolvedValue([makeCandle({ time: Date.now() - 5 * 60_000 })]);
        shouldOpenMock.mockReturnValue(true);
        generateSignalMock.mockReturnValue({ type: "BUY", price: 100, confidence: 90, quality: "High" });
        dbMock.getOpenSignals.mockReturnValue([]);
        evaluatePortfolioRiskMock.mockReturnValue({ allowed: false, reasons: ["too many BUY positions"] });

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(dbMock.insertSignal).not.toHaveBeenCalled();
    });

    it("inserts a new signal with entry cost applied and fires a notification above threshold", async () => {
        fetchCandlesMock.mockResolvedValue([makeCandle({ time: Date.now() - 5 * 60_000, close: 100 })]);
        shouldOpenMock.mockReturnValue(true);
        generateSignalMock.mockReturnValue({
            type: "BUY",
            price: 100,
            confidence: 92,
            quality: "High",
            strategy: "Fake Strategy",
            risk: { stopLoss: 98, takeProfit: 105, rewardMultiple: 2.5 },
            regime: { primary: "trending" },
            reason: "test reason"
        });
        createEntryFillMock.mockReturnValue(100.05);
        meetsNotifyThresholdMock.mockReturnValue(true);

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(dbMock.insertSignal).toHaveBeenCalledWith(
            expect.objectContaining({
                symbol: "BTC/USDT",
                assetClass: "crypto",
                strategyId: "fakeStrategy",
                type: "BUY",
                entryPrice: 100.05,
                stopLoss: 98,
                takeProfit: 105,
                regime: "trending"
            })
        );
        expect(sendDiscordMessageMock).toHaveBeenCalledWith("formatted");
    });

    it("does not notify when the signal is below the configured threshold", async () => {
        fetchCandlesMock.mockResolvedValue([makeCandle({ time: Date.now() - 5 * 60_000 })]);
        shouldOpenMock.mockReturnValue(true);
        generateSignalMock.mockReturnValue({ type: "BUY", price: 100, confidence: 40, quality: "Low" });
        meetsNotifyThresholdMock.mockReturnValue(false);

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(dbMock.insertSignal).toHaveBeenCalled();
        expect(sendDiscordMessageMock).not.toHaveBeenCalled();
    });

    it("resolves an existing open trade's exit before generating any new signal", async () => {
        const closedCandle = makeCandle({ time: Date.now() - 5 * 60_000 });
        fetchCandlesMock.mockResolvedValue([closedCandle]);
        dbMock.getOpenSignals.mockReturnValue([
            { id: 7, type: "BUY", stop_loss: 90, take_profit: 110, entry_price: 100, candles_since_open: 3, last_candle_time: closedCandle.time - 60_000, asset_class: "crypto" }
        ]);
        checkExitMock.mockReturnValue({
            exitPrice: 110,
            outcome: "win",
            closeReason: "take_profit",
            pnlPct: 10
        });

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(dbMock.incrementCandlesSinceOpen).toHaveBeenCalledWith(7, closedCandle.time);
        expect(checkExitMock).toHaveBeenCalled();
        expect(dbMock.closeSignal).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ outcome: "win", closeReason: "take_profit", pnlPct: 10 })
        );
    });

    it("does not advance the hold counter when polled again before a new candle has closed", async () => {
        const closedCandle = makeCandle({ time: Date.now() - 5 * 60_000 });
        fetchCandlesMock.mockResolvedValue([closedCandle]);
        dbMock.getOpenSignals.mockReturnValue([
            { id: 7, type: "BUY", stop_loss: 90, take_profit: 110, entry_price: 100, candles_since_open: 3, last_candle_time: closedCandle.time, asset_class: "crypto" }
        ]);
        checkExitMock.mockReturnValue(null);

        await scanSymbol({ symbol: "BTC/USDT", assetClass: "crypto" });

        expect(dbMock.incrementCandlesSinceOpen).not.toHaveBeenCalled();
        expect(checkExitMock).toHaveBeenCalledWith(
            expect.anything(),
            closedCandle,
            3, // unchanged candlesSinceOpen, since last_candle_time already matches this candle
            expect.anything(),
            expect.anything(),
            "crypto",
            expect.anything()
        );
    });
});
