// Live FX data via Twelve Data (https://twelvedata.com). Mirrors the public
// interface of MarketDataService (constructor, setMarket, getCandles,
// getHistoricalCandles, connect/disconnect, onCandle/onTick/onStatus) so
// UnifiedMarketDataService can swap between crypto and forex without the
// rest of the app knowing which provider is active.
//
// IMPORTANT — this is REST polling, not a real WebSocket, and that's a
// deliberate, honest choice, not an oversight: Twelve Data's WebSocket is
// only fully available from the Pro plan up (free Basic/trial WebSocket
// access is credit-limited and meant for testing, not sustained streaming
// - see https://support.twelvedata.com/en/articles/5194610-websocket-faq).
// Polling on the free tier also has to respect real budget constraints:
// 800 API calls/day and 8/minute. A default 30s poll interval is ~2
// calls/min (well under the per-minute cap) and ~2,880 calls/day if left
// running 24/7 - fine for a normal trading session, but you WILL exceed
// the daily quota if this stays connected around the clock. Tune
// POLL_INTERVAL_MS below if you need it to run longer, or upgrade your
// Twelve Data plan and swap this for a real WebSocket later - the
// candle/tick callback shape wouldn't need to change, only connect().
//
// Also honest about "tick" semantics: unlike the Binance service, there is
// no sub-candle price feed here. Every poll just re-fetches the latest bar
// and re-emits its close as a "tick" - it's a live PRICE, not a live
// intra-candle stream. Don't read more granularity into it than that.

const BASE_URL = "https://api.twelvedata.com/time_series";
const API_KEY = import.meta.env?.VITE_TWELVEDATA_API_KEY ?? "";

const INTERVAL_MAP = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "1h": "1h",
    "1d": "1day"
};

const POLL_INTERVAL_MS = 30_000; // ~2 calls/min - see budget note above
const MAX_POLL_MS = 120_000; // backoff ceiling if we get rate-limited
const POLL_FETCH_SIZE = 3; // small on purpose - every poll costs 1 API credit regardless of outputsize

export class ForexDataService {
    constructor(symbol = "eurusd", interval = "1m", limit = 200) {
        this.symbol = symbol;
        this.interval = interval;
        this.limit = limit;
        this.pollTimer = null;
        this.currentPollMs = POLL_INTERVAL_MS;
        this.manualDisconnect = false;
        this.lastEmittedTime = null;
        this.candleCallbacks = [];
        this.tickCallbacks = [];
        this.statusCallbacks = [];

        if (!API_KEY) {
            console.warn(
                "[ForexDataService] No Twelve Data API key found. Set VITE_TWELVEDATA_API_KEY in frontend/.env " +
                "(copy frontend/.env.example) - forex requests will fail with a 401 until then."
            );
        }
    }

    setMarket(symbol, interval = this.interval) {
        this.symbol = symbol;
        this.interval = interval;
        this.lastEmittedTime = null; // switching pairs - don't compare new candles against the old pair's timestamps
    }

    async getCandles(symbol = this.symbol, interval = this.interval, limit = this.limit) {
        return fetchTimeSeries(symbol, interval, { outputsize: limit });
    }

    // Twelve Data allows up to 5000 points in a single time_series call
    // (the free tier's own per-request ceiling), so unlike Binance's
    // 1000-candle pagination this rarely needs more than one request - the
    // Strategy Lab's lookback UI tops out at 3000. Pagination via
    // `end_date` is included as a fallback for anything that does ask for
    // more than 5000, capped at `maxRequests` as a runaway guard.
    async getHistoricalCandles(symbol = this.symbol, interval = this.interval, options = {}) {
        const { total = 1000, endDate = null, maxRequests = 5 } = options;
        const PAGE_SIZE = 5000;

        if (total <= PAGE_SIZE) {
            return fetchTimeSeries(symbol, interval, { outputsize: total, endDate });
        }

        const pages = [];
        let cursor = endDate;
        let collected = 0;
        let requests = 0;

        while (collected < total && requests < maxRequests) {
            const outputsize = Math.min(PAGE_SIZE, total - collected);
            const page = await fetchTimeSeries(symbol, interval, { outputsize, endDate: cursor });
            requests += 1;
            if (!page.length) break;

            pages.unshift(page);
            collected += page.length;
            cursor = new Date(page[0].time - 1).toISOString();

            if (page.length < outputsize) break; // provider has no earlier history than this
        }

        const seen = new Set();
        const merged = [];
        for (const candle of pages.flat()) {
            if (seen.has(candle.time)) continue;
            seen.add(candle.time);
            merged.push(candle);
        }
        merged.sort((a, b) => a.time - b.time);

        return merged.slice(-total);
    }

    connect() {
        this.disconnect();
        this.manualDisconnect = false;
        this.currentPollMs = POLL_INTERVAL_MS;
        this.setStatus("Connecting");
        this.poll();
    }

    disconnect() {
        this.manualDisconnect = true;
        window.clearTimeout(this.pollTimer);
        this.pollTimer = null;
    }

    async poll() {
        try {
            const rows = await this.getCandles(this.symbol, this.interval, POLL_FETCH_SIZE);
            this.currentPollMs = POLL_INTERVAL_MS; // reset backoff on success
            this.setStatus("Connected (polling)");

            const latest = rows.at(-1);
            if (latest) {
                this.tickCallbacks.forEach(callback => callback({ ...latest, closed: false }));

                if (this.lastEmittedTime === null || latest.time > this.lastEmittedTime) {
                    this.lastEmittedTime = latest.time;
                    this.candleCallbacks.forEach(callback => callback({ ...latest, closed: true }));
                }
            }
        } catch (error) {
            if (error.rateLimited) {
                this.currentPollMs = Math.min(this.currentPollMs * 2, MAX_POLL_MS);
                this.setStatus(`Rate limited, backing off to ${Math.round(this.currentPollMs / 1000)}s`);
            } else {
                this.setStatus("Connection error");
            }
        }

        if (!this.manualDisconnect) {
            this.pollTimer = window.setTimeout(() => this.poll(), this.currentPollMs);
        }
    }

    onCandle(callback) {
        this.candleCallbacks.push(callback);
    }

    onTick(callback) {
        this.tickCallbacks.push(callback);
    }

    onStatus(callback) {
        this.statusCallbacks.push(callback);
    }

    setStatus(status) {
        this.statusCallbacks.forEach(callback => callback(status));
    }
}

// Twelve Data expects physical currency pairs as "EUR/USD". The UI carries
// pairs the same lowercase-no-separator way the Binance service does
// ("eurusd"), so this splits on the assumption forex pair values are
// always 6 letters (3 + 3) - true for every major/minor/cross pair.
function toTwelveDataSymbol(symbol) {
    if (symbol.includes("/")) return symbol.toUpperCase();
    const clean = symbol.toUpperCase();
    return `${clean.slice(0, 3)}/${clean.slice(3, 6)}`;
}

async function fetchTimeSeries(symbol, interval, { outputsize, endDate = null } = {}) {
    const params = new URLSearchParams({
        symbol: toTwelveDataSymbol(symbol),
        interval: INTERVAL_MAP[interval] ?? interval,
        outputsize: String(outputsize),
        order: "asc",
        apikey: API_KEY
    });
    if (endDate) params.set("end_date", endDate);

    const response = await fetch(`${BASE_URL}?${params.toString()}`);
    const data = await response.json();

    if (data.status === "error" || data.code >= 400) {
        const rateLimited = data.code === 429
            || /credit|limit/i.test(data.message ?? "");
        const err = new Error(`Twelve Data request failed: ${data.message ?? response.status}`);
        err.rateLimited = rateLimited;
        throw err;
    }

    if (!Array.isArray(data.values)) return [];

    return data.values.map(row => ({
        time: new Date(row.datetime).getTime(),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: null, // Twelve Data forex bars don't carry real trade volume
        closed: true
    })).sort((a, b) => a.time - b.time); // defensive - don't fully trust `order=asc` under all conditions
}
