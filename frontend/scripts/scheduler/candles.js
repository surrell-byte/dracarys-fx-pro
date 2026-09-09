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

// Binance caps klines at 1000 per call. ccxt's fetchOHLCV silently returns
// whatever the exchange gives back instead of erroring or paginating, so a
// `limit` above 1000 (e.g. 1320 = warmup + scored candles) used to come back
// truncated to 1000 with no warning. This walks backwards in <=1000-candle
// pages using `since`, then trims to exactly `limit` from the end.
const BINANCE_MAX_CANDLES_PER_CALL = 1000;

function timeframeToMs(timeframe) {
    const unit = timeframe.slice(-1);
    const n = Number(timeframe.slice(0, -1));
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    if (!unitMs || !Number.isFinite(n)) {
        throw new Error(`Cannot compute duration for timeframe "${timeframe}"`);
    }
    return n * unitMs;
}

export async function fetchCandles({ symbol, assetClass, timeframe, limit }) {
    return assetClass === "forex"
        ? fetchForexCandles({ symbol, timeframe, limit })
        : fetchCryptoCandles({ symbol, timeframe, limit });
}

async function fetchCryptoCandles({ symbol, timeframe, limit }) {
    if (limit <= BINANCE_MAX_CANDLES_PER_CALL) {
        const ohlcv = await binance.fetchOHLCV(symbol, timeframe, undefined, limit);
        return ohlcv.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
    }

    // Page backwards from "now" so the most recent candle is always included,
    // then trim to `limit` from the end (oldest candles get dropped first,
    // matching what a single larger call would have returned had one existed).
    const tfMs = timeframeToMs(timeframe);
    const totalSpanMs = limit * tfMs;
    let since = Date.now() - totalSpanMs;
    const seen = new Map(); // dedupe by timestamp across page boundaries

    while (seen.size < limit) {
        const page = await binance.fetchOHLCV(symbol, timeframe, since, BINANCE_MAX_CANDLES_PER_CALL);
        if (!page.length) break;
        for (const [time, open, high, low, close, volume] of page) {
            seen.set(time, { time, open, high, low, close, volume });
        }
        const lastTime = page[page.length - 1][0];
        const nextSince = lastTime + tfMs;
        if (nextSince <= since) break; // guard against a stuck loop
        since = nextSince;
        if (page.length < BINANCE_MAX_CANDLES_PER_CALL) break; // exchange has no more data
    }

    const sorted = [...seen.values()].sort((a, b) => a.time - b.time);
    return sorted.slice(-limit);
}

// Twelve Data's free tier allows 8 API credits/minute. Each time_series
// call costs at least 1 credit, and callers here (the walk-forward runner
// especially) can fire several forex requests back-to-back with no natural
// gap between them, which burst past the limit even though total usage
// over a longer window is fine. This enforces a minimum spacing between
// forex requests so a full run stays under the per-minute cap instead of
// erroring partway through. 8 credits/min = 1 every 7.5s; round up to 8s
// per request for margin (allows ~7.5 req/min, safely under 8).
const TWELVEDATA_MIN_REQUEST_GAP_MS = 8000;
let lastTwelveDataRequestAt = 0;

async function throttleTwelveDataRequest() {
    // During tests we don't want to incur the real-world 8s throttle delay,
    // which would make unit tests timeout. Short-circuit when running under
    // the test runner to keep tests fast and deterministic.
    if (process.env.NODE_ENV === "test") {
        lastTwelveDataRequestAt = Date.now();
        return;
    }

    const elapsed = Date.now() - lastTwelveDataRequestAt;
    const waitMs = TWELVEDATA_MIN_REQUEST_GAP_MS - elapsed;
    if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastTwelveDataRequestAt = Date.now();
}

async function fetchForexCandles({ symbol, timeframe, limit }) {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
        throw new Error(`TWELVEDATA_API_KEY not set - required to scan forex symbol ${symbol}`);
    }
    const interval = TWELVEDATA_INTERVAL[timeframe] ?? "1min";
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${limit}&apikey=${apiKey}`;
    await throttleTwelveDataRequest();
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
            // Forex has no real volume data. The browser's forexDataService
            // correctly reports `null` for this (so downstream volumeRatio
            // logic can distinguish "no data" from "zero volume"); this
            // scheduler path was defaulting to 0 instead, which is a
            // different signal to any indicator that branches on it.
            volume: v.volume != null ? Number(v.volume) : null
        }))
        .reverse(); // Twelve Data returns newest-first; signalEngine expects oldest-first
}
