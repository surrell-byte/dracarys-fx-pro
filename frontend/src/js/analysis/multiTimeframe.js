import { UnifiedMarketDataService } from "@services/unifiedMarketDataService.js";
import { calculateEMA } from "@indicators/indicators.js";

const service = new UnifiedMarketDataService();

export async function getMultiTimeframe(symbol, assetClass = "crypto") {
    const [m1, m5, m15] = await Promise.all([
        service.getCandles(symbol, "1m", undefined, assetClass),
        service.getCandles(symbol, "5m", undefined, assetClass),
        service.getCandles(symbol, "15m", undefined, assetClass)
    ]);

    return { m1, m5, m15 };
}

// Module 2 (Higher Timeframe Trend): daily EMA50 vs EMA200 sets the
// higher-timeframe bias used to gate lower-timeframe entries — only longs
// when daily EMA50 > EMA200, only shorts when it's below.
export async function getHigherTimeframeTrend(symbol, assetClass = "crypto", interval = "1d", limit = 260) {
    try {
        const candles = await service.getCandles(symbol, interval, limit, assetClass);

        if (candles.length < 200) {
            return { trend: "NEUTRAL", ema50: null, ema200: null, ready: false };
        }

        const closes = candles.map(candle => candle.close);
        const ema50 = calculateEMA(closes, 50).at(-1);
        const ema200 = calculateEMA(closes, 200).at(-1);

        let trend = "NEUTRAL";
        if (Number.isFinite(ema50) && Number.isFinite(ema200)) {
            if (ema50 > ema200) trend = "UP";
            else if (ema50 < ema200) trend = "DOWN";
        }

        return { trend, ema50: ema50 ?? null, ema200: ema200 ?? null, ready: true };
    } catch (error) {
        // Permissive fallback: if the daily fetch fails, don't block trading —
        // just report NEUTRAL so the HTF filter is a no-op until it recovers.
        return { trend: "NEUTRAL", ema50: null, ema200: null, ready: false, error: error.message };
    }
}
