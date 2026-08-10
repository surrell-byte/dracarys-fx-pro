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

const { fetchCandles } = await import("../scripts/scheduler/candles.js");

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

        expect(fetchOHLCVMock).toHaveBeenCalledWith("BTC/USDT", "1m", undefined, 2);
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
});
