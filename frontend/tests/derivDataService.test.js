import { describe, expect, it, vi } from "vitest";
import { DerivDataService } from "@services/derivDataService.js";

describe("DerivDataService", () => {
    it("emits the active candle as a tick and each completed candle once", () => {
        const service = new DerivDataService("eurusd", "1m", 200, "test-app");
        const ticks = [];
        const candles = [];
        service.onTick(candle => ticks.push(candle));
        service.onCandle(candle => candles.push(candle));

        service.handleMessage({
            msg_type: "candles",
            candles: [
                { epoch: 100, open: "1", high: "2", low: "0.5", close: "1.5" },
                { epoch: 160, open: "1.5", high: "2.5", low: "1", close: "2" },
                { epoch: 220, open: "2", high: "3", low: "1.5", close: "2.5" }
            ]
        });
        service.handleMessage({
            msg_type: "candles",
            candles: [
                { epoch: 160, open: "1.5", high: "2.5", low: "1", close: "2" },
                { epoch: 220, open: "2", high: "3", low: "1.5", close: "2.5" },
                { epoch: 280, open: "2.5", high: "3.5", low: "2", close: "3" }
            ]
        });

        expect(ticks.map(candle => [candle.time, candle.closed])).toEqual([
            [220000, false],
            [280000, false]
        ]);
        expect(candles.map(candle => [candle.time, candle.closed])).toEqual([
            [280000 - 60000, true]
        ]);
    });

    it("reports API errors without emitting a candle", () => {
        const service = new DerivDataService();
        const status = [];
        const candle = vi.fn();
        service.onStatus(value => status.push(value));
        service.onCandle(candle);

        service.handleMessage({ error: { message: "Invalid symbol" } });

        expect(status).toEqual(["Deriv error: Invalid symbol"]);
        expect(candle).not.toHaveBeenCalled();
    });
});
