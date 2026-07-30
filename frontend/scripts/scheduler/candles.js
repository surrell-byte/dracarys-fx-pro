// Candle fetching, kept separate from runScheduler.js so the data source
// can be swapped or mocked without touching scheduling/trade logic.
// Crypto goes through ccxt/Binance (public REST, no key). Forex goes
// through Twelve Data's REST time_series endpoint directly - not through
// frontend/src/js/services/forexDataService.js, because that class is
// built around a live poll-and-callback loop for the browser UI
// (import.meta.env, WebSocket-style subscriptions); this just needs a
// single one-shot fetch per cycle, so a plain REST call is simpler and has
// no browser-only assumptions baked in.

import ccxt from "ccxt";

const TWELVEDATA_INTERVAL = {
    "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "1d": "1day"
};

const binance = new ccxt.binance();

export async function fetchCandles({ symbol, assetClass, timeframe, limit }) {
    return assetClass === "forex"
        ? fetchForexCandles({ symbol, timeframe, limit })
        : fetchCryptoCandles({ symbol, timeframe, limit });
}

async function fetchCryptoCandles({ symbol, timeframe, limit }) {
    const ohlcv = await binance.fetchOHLCV(symbol, timeframe, undefined, limit);
    return ohlcv.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
}

async function fetchForexCandles({ symbol, timeframe, limit }) {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
        throw new Error(`TWELVEDATA_API_KEY not set - required to scan forex symbol ${symbol}`);
    }
    const interval = TWELVEDATA_INTERVAL[timeframe] ?? "1min";
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${limit}&apikey=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "error") throw new Error(data.message || `Twelve Data error for ${symbol}`);
    if (!Array.isArray(data.values)) throw new Error(`Unexpected Twelve Data response for ${symbol}`);

    return data.values
        .map(v => ({
            time: new Date(v.datetime).getTime(),
            open: Number(v.open),
            high: Number(v.high),
            low: Number(v.low),
            close: Number(v.close),
            volume: Number(v.volume ?? 0)
        }))
        .reverse(); // Twelve Data returns newest-first; signalEngine expects oldest-first
}
