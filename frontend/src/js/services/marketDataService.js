const BINANCE_REST_URL = "https://api.binance.com/api/v3/klines";
const BINANCE_STREAM_URL = "wss://stream.binance.com:9443/ws";

export class MarketDataService {
    constructor(symbol = "btcusdt", interval = "1m", limit = 200) {
        this.symbol = normalizeStreamSymbol(symbol);
        this.interval = interval;
        this.limit = limit;
        this.ws = null;
        this.connectionId = 0;
        this.manualDisconnect = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.candleCallbacks = [];
        this.tickCallbacks = [];
        this.statusCallbacks = [];
    }

    setMarket(symbol, interval = this.interval) {
        this.symbol = normalizeStreamSymbol(symbol);
        this.interval = interval;
    }

    async getCandles(symbol = this.symbol, interval = this.interval, limit = this.limit) {
        const streamSymbol = normalizeStreamSymbol(symbol);
        const params = new URLSearchParams({
            symbol: streamSymbol.toUpperCase(),
            interval,
            limit: String(limit)
        });
        const response = await fetch(`${BINANCE_REST_URL}?${params.toString()}`);

        if (!response.ok) {
            throw new Error(`Binance candles request failed: ${response.status}`);
        }

        const rows = await response.json();
        return rows.map(klineToCandle);
    }

    // Backtesting needs far more history than a single REST call can return
    // (Binance caps each request at 1000 candles regardless of what `limit`
    // asks for). This walks backward in time using `endTime`, stitching
    // 1000-candle pages together until either `total` is reached, the
    // exchange runs out of history (a page comes back shorter than asked),
    // or `maxRequests` is hit as a hard stop against a runaway loop.
    //
    // Returns candles sorted ascending by time, deduped by timestamp, and
    // trimmed to exactly `total` (the most recent `total` candles ending at
    // `endTime`). This is a plain fetch - it doesn't touch `this.symbol`/
    // `this.interval` or any live streaming state, so it's safe to call
    // alongside an active connect().
    async getHistoricalCandles(symbol = this.symbol, interval = this.interval, options = {}) {
        const { total = 1000, endTime = Date.now(), maxRequests = 20 } = options;
        const PAGE_SIZE = 1000;
        const streamSymbol = normalizeStreamSymbol(symbol);

        const pages = [];
        let cursor = endTime;
        let collected = 0;
        let requests = 0;

        while (collected < total && requests < maxRequests) {
            const limit = Math.min(PAGE_SIZE, total - collected);
            const params = new URLSearchParams({
                symbol: streamSymbol.toUpperCase(),
                interval,
                limit: String(limit),
                endTime: String(cursor)
            });

            const response = await fetch(`${BINANCE_REST_URL}?${params.toString()}`);
            requests += 1;

            if (!response.ok) {
                throw new Error(`Binance historical candles request failed: ${response.status}`);
            }

            const rows = await response.json();
            if (!rows.length) break;

            const candles = rows.map(klineToCandle);
            pages.unshift(candles);
            collected += candles.length;

            const earliest = candles[0].time;
            if (earliest >= cursor) break; // no progress - bail rather than loop forever
            cursor = earliest - 1;

            if (candles.length < limit) break; // exchange has no earlier history than this
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
        this.setStatus("Connecting");
        this.manualDisconnect = false;
        const connectionId = ++this.connectionId;

        const url = `${BINANCE_STREAM_URL}/${this.symbol}@kline_${this.interval}`;
        this.ws = new WebSocket(url);

        this.ws.addEventListener("open", () => {
            if (connectionId !== this.connectionId) return;
            this.reconnectAttempts = 0;
            this.setStatus("Connected");
        });

        this.ws.addEventListener("message", (event) => {
            if (connectionId !== this.connectionId) return;
            const message = JSON.parse(event.data);
            const candle = streamKlineToCandle(message.k);

            this.tickCallbacks.forEach(callback => callback(candle));

            if (candle.closed) {
                this.candleCallbacks.forEach(callback => callback(candle));
            }
        });

        this.ws.addEventListener("close", () => {
            if (connectionId !== this.connectionId || this.manualDisconnect) return;
            this.ws = null;
            this.scheduleReconnect();
        });

        this.ws.addEventListener("error", () => {
            if (connectionId !== this.connectionId) return;
            this.setStatus("Connection error");
            if (this.ws) {
                this.ws.close();
            }
        });
    }

    disconnect() {
        window.clearTimeout(this.reconnectTimer);
        this.connectionId += 1;
        this.manualDisconnect = true;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= 5) {
            this.setStatus("Disconnected");
            return;
        }

        this.reconnectAttempts += 1;
        this.setStatus(`Reconnecting ${this.reconnectAttempts}/5`);
        this.reconnectTimer = window.setTimeout(() => this.connect(), 2500);
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

function normalizeStreamSymbol(symbol) {
    return symbol.replace("/", "").toLowerCase();
}

function klineToCandle(kline) {
    return {
        time: kline[0],
        open: Number(kline[1]),
        high: Number(kline[2]),
        low: Number(kline[3]),
        close: Number(kline[4]),
        volume: Number(kline[5]),
        closed: true
    };
}

function streamKlineToCandle(kline) {
    return {
        time: kline.t,
        open: Number(kline.o),
        high: Number(kline.h),
        low: Number(kline.l),
        close: Number(kline.c),
        volume: Number(kline.v),
        closed: kline.x
    };
}

