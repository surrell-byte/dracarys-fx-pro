import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// candles.js constructs `new ccxt.binance()` once at module load time, so
// the mock's fetchOHLCV needs to live on the instance returned by that
// constructor - hoisted so it's in place before the module under test
// (and its top-level `new ccxt.binance()` call) is ever imported.
const { fetchOHLCVMock, binanceCtorMock } = vi.hoisted(() => {
    const fetchOHLCVMock = vi.fn();
    function binanceCtorMock() {
        return { fetchOHLCV: fetchOHLCVMock };
    }
    return { fetchOHLCVMock, binanceCtorMock: vi.fn(binanceCtorMock) };
});

vi.mock("ccxt", () => ({
    default: { binance: binanceCtorMock }
}));

const {
    fetchCandles,
    fetchCandlesWithMetadata,
    inspectCandleSeries,
    stitchCandlePages
} = await import("../scripts/scheduler/candles.js");
const { ForexDataService } = await import("../src/js/services/forexDataService.js");

const ORIGINAL_API_KEY = process.env.TWELVEDATA_API_KEY;

beforeEach(() => {
    fetchOHLCVMock.mockReset();
    vi.unstubAllGlobals();
});

afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) delete process.env.TWELVEDATA_API_KEY;
    else process.env.TWELVEDATA_API_KEY = ORIGINAL_API_KEY;
});

describe("fetchCandles - crypto (Binance via ccxt)", () => {
    it("maps ccxt's positional OHLCV arrays into named candle objects", async () => {
        fetchOHLCVMock.mockResolvedValue([
            [1_700_000_000_000, 100, 105, 95, 102, 10],
            [1_700_000_060_000, 102, 106, 101, 104, 12]
        ]);

        const candles = await fetchCandles({
            symbol: "BTC/USDT",
            assetClass: "crypto",
            timeframe: "1m",
            limit: 2
        });

        const [requestedSymbol, requestedTimeframe, since, requestedLimit] = fetchOHLCVMock.mock.calls[0];
        expect(requestedSymbol).toBe("BTC/USDT");
        expect(requestedTimeframe).toBe("1m");
        expect(Number.isFinite(since)).toBe(true);
        expect(requestedLimit).toBe(2);
        expect(candles).toEqual([
            { time: 1_700_000_000_000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
            { time: 1_700_000_060_000, open: 102, high: 106, low: 101, close: 104, volume: 12 }
        ]);
    });

    it("propagates a network/exchange failure so the caller can decide how to handle it", async () => {
        fetchOHLCVMock.mockRejectedValue(new Error("Binance request timed out"));

        await expect(
            fetchCandles({ symbol: "BTC/USDT", assetClass: "crypto", timeframe: "1m", limit: 5 })
        ).rejects.toThrow("Binance request timed out");
    });

    it("paginates Binance history to the exact inclusive end boundary", async () => {
        const endTime = 1_700_000_000_000;
        const intervalMs = 60_000;
        const lastOpen = Math.floor(endTime / intervalMs) * intervalMs;
        const closedLastOpen = lastOpen - intervalMs;
        const firstOpen = closedLastOpen - (1000 * intervalMs);
        fetchOHLCVMock.mockImplementation(async (_symbol, _timeframe, since, limit) =>
            Array.from({ length: limit }, (_, index) => {
                const time = since + (index * intervalMs);
                return [time, 1.1, 1.2, 1.0, 1.15, 100 + index];
            })
        );

        const result = await fetchCandlesWithMetadata({
            symbol: "EUR/USDT",
            assetClass: "crypto",
            timeframe: "1m",
            limit: 1001,
            endTime
        });

        expect(fetchOHLCVMock).toHaveBeenCalledTimes(2);
        expect(fetchOHLCVMock.mock.calls.map((call) => call[3])).toEqual([1000, 1]);
        expect(result.candles).toHaveLength(1001);
        expect(result.candles[0].time).toBe(firstOpen);
        expect(result.candles.at(-1).time).toBe(closedLastOpen);
        expect(result.candles[0]).toEqual({
            time: firstOpen,
            open: 1.1,
            high: 1.2,
            low: 1.0,
            close: 1.15,
            volume: 100
        });
        expect(result.integrity.orderingValid).toBe(true);
        expect(result.duplicateCount).toBe(0);
    });
});

describe("fetchCandles - forex (Twelve Data via REST)", () => {
    it("throws immediately when TWELVEDATA_API_KEY isn't set, without making a network call", async () => {
        delete process.env.TWELVEDATA_API_KEY;
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        await expect(
            fetchCandles({ symbol: "EUR/USD", assetClass: "forex", timeframe: "1m", limit: 10 })
        ).rejects.toThrow(/TWELVEDATA_API_KEY not set/);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reverses Twelve Data's newest-first order and normalizes fields, including null volume", async () => {
        process.env.TWELVEDATA_API_KEY = "test-key";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            json: async () => ({
                status: "ok",
                values: [
                    { datetime: "2026-08-01 12:01:00", open: "1.10", high: "1.11", low: "1.09", close: "1.105" },
                    { datetime: "2026-08-01 12:00:00", open: "1.09", high: "1.10", low: "1.08", close: "1.095" }
                ]
            })
        }));

        const candles = await fetchCandles({
            symbol: "EUR/USD",
            assetClass: "forex",
            timeframe: "1m",
            limit: 2
        });

        // Twelve Data returned newest-first; fetchCandles must hand back
        // oldest-first to match what signalEngine.js expects.
        expect(candles.map(c => c.close)).toEqual([1.095, 1.105]);
        expect(candles[0].volume).toBeNull();
        expect(candles.every(c => typeof c.time === "number")).toBe(true);
    });

    it("maps Twelve Data's declared volume through as a number when present", async () => {
        process.env.TWELVEDATA_API_KEY = "test-key";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            json: async () => ({
                status: "ok",
                values: [
                    { datetime: "2026-08-01 12:00:00", open: "1.09", high: "1.10", low: "1.08", close: "1.095", volume: "1500" }
                ]
            })
        }));

        const [candle] = await fetchCandles({
            symbol: "EUR/USD",
            assetClass: "forex",
            timeframe: "1m",
            limit: 1
        });
        expect(candle.volume).toBe(1500);
    });

    it("throws with Twelve Data's own error message when the API reports an error", async () => {
        process.env.TWELVEDATA_API_KEY = "test-key";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            json: async () => ({ status: "error", message: "Invalid API key" })
        }));

        await expect(
            fetchCandles({ symbol: "EUR/USD", assetClass: "forex", timeframe: "1m", limit: 10 })
        ).rejects.toThrow("Invalid API key");
    });

    it("throws a clear error when the response shape is unexpected (no values array)", async () => {
        process.env.TWELVEDATA_API_KEY = "test-key";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            json: async () => ({ status: "ok" })
        }));

        await expect(
            fetchCandles({ symbol: "EUR/USD", assetClass: "forex", timeframe: "1m", limit: 10 })
        ).rejects.toThrow(/Unexpected Twelve Data response/);
    });

    it("falls back to the 1min interval mapping for an unrecognized timeframe", async () => {
        process.env.TWELVEDATA_API_KEY = "test-key";
        const fetchSpy = vi.fn().mockResolvedValue({
            json: async () => ({ status: "ok", values: [] })
        });
        vi.stubGlobal("fetch", fetchSpy);

        await fetchCandles({ symbol: "EUR/USD", assetClass: "forex", timeframe: "3m", limit: 10 });

        const calledUrl = fetchSpy.mock.calls[0][0];
        expect(calledUrl).toContain("interval=1min");
    });

    it("paginates and stitches Twelve Data responses without losing OHLCV or UTC timestamps", async () => {
        process.env.TWELVEDATA_API_KEY = "test-key";
        const endTime = Date.parse("2026-06-01T00:00:00.000Z");
        const intervalMs = 60_000;
        const closedEndTime = endTime - intervalMs;
        const firstPageStart = closedEndTime - (4999 * intervalMs);
        const fetchSpy = vi.fn(async (url) => {
            const params = new URL(url).searchParams;
            const outputsize = Number(params.get("outputsize"));
            const firstTime = outputsize === 5000
                ? firstPageStart
                : firstPageStart - intervalMs;
            return {
                json: async () => ({
                    status: "ok",
                    values: Array.from({ length: outputsize }, (_, index) => ({
                        datetime: new Date(firstTime + (index * intervalMs)).toISOString().replace("T", " ").slice(0, 19),
                        open: "1.10001",
                        high: "1.20002",
                        low: "1.00003",
                        close: "1.15004",
                        volume: "123.5"
                    }))
                })
            };
        });
        vi.stubGlobal("fetch", fetchSpy);

        const result = await fetchCandlesWithMetadata({
            symbol: "EUR/USD",
            assetClass: "forex",
            timeframe: "1m",
            limit: 5001,
            endTime
        });

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(new URL(fetchSpy.mock.calls[0][0]).searchParams.get("outputsize")).toBe("5000");
        expect(new URL(fetchSpy.mock.calls[1][0]).searchParams.get("outputsize")).toBe("1");
        expect(new URL(fetchSpy.mock.calls[0][0]).searchParams.get("timezone")).toBe("UTC");
        expect(result.candles).toHaveLength(5001);
        expect(result.candles[0].time).toBe(firstPageStart - intervalMs);
        expect(result.candles.at(-1).time).toBe(closedEndTime);
        expect(result.candles[0]).toEqual({
            time: firstPageStart - intervalMs,
            open: 1.10001,
            high: 1.20002,
            low: 1.00003,
            close: 1.15004,
            volume: 123.5
        });
        expect(result.integrity.orderingValid).toBe(true);
        expect(result.duplicateCount).toBe(0);
    });
});

describe("historical candle assembly and integrity", () => {
    const first = { time: 60_000, open: 1, high: 3, low: 0.5, close: 2, volume: 10 };
    const second = { time: 120_000, open: 2, high: 4, low: 1, close: 3, volume: 11 };
    const third = { time: 180_000, open: 3, high: 5, low: 2, close: 4, volume: 12 };

    it("deduplicates pages, sorts chronologically, and preserves candle values", () => {
        const result = stitchCandlePages([[third, second], [first, second]], { endTime: second.time });

        expect(result.candles).toEqual([first, second]);
        expect(result.rawCandleCount).toBe(4);
        expect(result.duplicateCount).toBe(1);
    });

    it("assembles repeated inputs deterministically", () => {
        const pages = [[third, second], [first, second]];
        expect(stitchCandlePages(pages, { limit: 3 })).toEqual(
            stitchCandlePages(pages, { limit: 3 })
        );
    });

    it("detects missing intervals and invalid OHLCV without fabricating candles", () => {
        const report = inspectCandleSeries([
            first,
            { ...third, high: 1, volume: -1 }
        ], "1m", "crypto");

        expect(report.missingIntervalCount).toBe(1);
        expect(report.gaps[0].classification).toBe("unclassified_data_gap");
        expect(report.invalidCount).toBe(1);
        expect(report.candleCount).toBe(2);
    });

    it("classifies a forex weekend closure separately from an unexplained data gap", () => {
        const fridayClose = Date.parse("2026-10-02T21:00:00.000Z");
        const sundayOpen = Date.parse("2026-10-04T21:00:00.000Z");
        const report = inspectCandleSeries([
            { ...first, time: fridayClose },
            { ...second, time: sundayOpen }
        ], "15m", "forex");

        expect(report.gaps[0].classification).toBe("expected_market_closure");
    });

    it("classifies New Year and Good Friday FX closures as expected", () => {
        const newYear = inspectCandleSeries([
            { ...first, time: Date.parse("2024-12-31T00:00:00.000Z") },
            { ...second, time: Date.parse("2025-01-02T00:00:00.000Z") }
        ], "1d", "forex");
        const easter = inspectCandleSeries([
            { ...first, time: Date.parse("2025-04-17T00:00:00.000Z") },
            { ...second, time: Date.parse("2025-04-22T00:00:00.000Z") }
        ], "1d", "forex");

        expect(newYear.gaps[0].classification).toBe("expected_market_closure");
        expect(easter.gaps[0].classification).toBe("expected_market_closure");
    });
});

describe("ForexDataService - completed candle polling", () => {
    it("emits the newest bar as a tick and the preceding bar as closed", async () => {
        const service = new ForexDataService("eurusd", "1m");
        const ticks = [];
        const candles = [];
        service.onTick((candle) => ticks.push(candle));
        service.onCandle((candle) => candles.push(candle));
        service.getCandles = vi.fn()
            .mockResolvedValueOnce([
                { time: 1, close: 1 },
                { time: 2, close: 2 },
                { time: 3, close: 3 }
            ])
            .mockResolvedValueOnce([
                { time: 2, close: 2 },
                { time: 3, close: 3 },
                { time: 4, close: 4 }
            ]);
        service.manualDisconnect = true;

        await service.poll();
        await service.poll();

        expect(ticks.map((candle) => [candle.time, candle.closed])).toEqual([
            [3, false],
            [4, false]
        ]);
        expect(candles.map((candle) => [candle.time, candle.closed])).toEqual([
            [2, true],
            [3, true]
        ]);
    });
});
