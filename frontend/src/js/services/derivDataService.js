// Official Deriv public market data over WebSocket. This provider is
// deliberately signals-only: it never authorizes or places contracts.

const DEFAULT_APP_ID = "1089";
const WS_BASE_URL = "wss://ws.derivws.com/websockets/v3";
const GRANULARITY_SECONDS = {
    "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400
};
const DEFAULT_SYMBOLS = {
    eurusd: "frxEURUSD", gbpusd: "frxGBPUSD", usdjpy: "frxUSDJPY",
    usdchf: "frxUSDCHF", audusd: "frxAUDUSD", usdcad: "frxUSDCAD",
    nzdusd: "frxNZDUSD", eurjpy: "frxEURJPY", gbpjpy: "frxGBPJPY"
};

export class DerivDataService {
    constructor(symbol = "eurusd", interval = "1m", limit = 200, appId = import.meta.env?.VITE_DERIV_APP_ID ?? DEFAULT_APP_ID) {
        this.symbol = symbol;
        this.interval = interval;
        this.limit = limit;
        this.appId = appId;
        this.ws = null;
        this.connectionId = 0;
        this.requestId = 0;
        this.manualDisconnect = false;
        this.reconnectTimer = null;
        this.lastClosedTime = null;
        this.candleCallbacks = [];
        this.tickCallbacks = [];
        this.statusCallbacks = [];
    }

    setMarket(symbol, interval = this.interval) {
        this.symbol = symbol;
        this.interval = interval;
        this.lastClosedTime = null;
    }

    async getCandles(symbol = this.symbol, interval = this.interval, limit = this.limit) {
        const response = await requestDeriv({
            ticks_history: derivSymbol(symbol), end: "latest", count: limit,
            style: "candles", granularity: granularity(interval)
        }, this.appId);
        return normalizeCandles(response.candles ?? []);
    }

    async getHistoricalCandles(symbol = this.symbol, interval = this.interval, options = {}) {
        return this.getCandles(symbol, interval, Math.min(options.total ?? this.limit, 5000));
    }

    connect() {
        this.disconnect();
        this.manualDisconnect = false;
        const connectionId = ++this.connectionId;
        this.setStatus("Connecting to Deriv");
        const WebSocketImpl = globalThis.WebSocket;
        if (!WebSocketImpl) {
            this.setStatus("Deriv unavailable: WebSocket not supported");
            return;
        }
        this.ws = new WebSocketImpl(`${WS_BASE_URL}?app_id=${encodeURIComponent(this.appId)}`);
        this.ws.addEventListener("open", () => {
            if (connectionId !== this.connectionId) return;
            this.setStatus("Connected to Deriv");
            this.send({
                ticks_history: derivSymbol(this.symbol), end: "latest",
                count: Math.min(this.limit, 5000), style: "candles",
                granularity: granularity(this.interval), subscribe: 1
            });
        });
        this.ws.addEventListener("message", event => {
            if (connectionId === this.connectionId) this.handleMessage(JSON.parse(event.data));
        });
        this.ws.addEventListener("error", () => {
            if (connectionId === this.connectionId) this.setStatus("Deriv connection error");
        });
        this.ws.addEventListener("close", () => {
            if (connectionId !== this.connectionId || this.manualDisconnect) return;
            this.ws = null;
            this.setStatus("Deriv disconnected");
            this.reconnectTimer = window.setTimeout(() => this.connect(), 2500);
        });
    }

    disconnect() {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.connectionId += 1;
        this.manualDisconnect = true;
        if (this.ws) this.ws.close();
        this.ws = null;
    }

    send(payload) {
        if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ ...payload, req_id: ++this.requestId }));
    }

    handleMessage(message) {
        if (message.error) {
            this.setStatus(`Deriv error: ${message.error.message}`);
            return;
        }
        if (message.msg_type !== "candles" || !Array.isArray(message.candles)) return;
        const candles = normalizeCandles(message.candles);
        const latest = candles.at(-1);
        const closed = candles.at(-2);
        if (!latest) return;
        this.tickCallbacks.forEach(callback => callback({ ...latest, closed: false }));
        if (!closed) return;
        if (this.lastClosedTime === null) {
            this.lastClosedTime = closed.time;
        } else if (closed.time > this.lastClosedTime) {
            this.lastClosedTime = closed.time;
            this.candleCallbacks.forEach(callback => callback({ ...closed, closed: true }));
        }
    }

    onCandle(callback) { this.candleCallbacks.push(callback); }
    onTick(callback) { this.tickCallbacks.push(callback); }
    onStatus(callback) { this.statusCallbacks.push(callback); }
    setStatus(status) { this.statusCallbacks.forEach(callback => callback(status)); }
}

function derivSymbol(symbol) {
    const normalized = symbol.replace("/", "").toLowerCase();
    return DEFAULT_SYMBOLS[normalized] ?? symbol;
}

function granularity(interval) {
    const value = GRANULARITY_SECONDS[interval];
    if (!value) throw new Error(`Unsupported Deriv interval: ${interval}`);
    return value;
}

function normalizeCandles(candles) {
    return candles.map(candle => ({
        time: Number(candle.epoch) * 1000,
        open: Number(candle.open), high: Number(candle.high),
        low: Number(candle.low), close: Number(candle.close),
        volume: null, closed: false
    })).filter(candle => Number.isFinite(candle.time) && Number.isFinite(candle.close));
}

async function requestDeriv(payload, appId) {
    const WebSocketImpl = globalThis.WebSocket;
    if (!WebSocketImpl) throw new Error("Deriv requires WebSocket support");
    return new Promise((resolve, reject) => {
        const ws = new WebSocketImpl(`${WS_BASE_URL}?app_id=${encodeURIComponent(appId)}`);
        const timeout = window.setTimeout(() => {
            ws.close();
            reject(new Error("Deriv market-data request timed out"));
        }, 10_000);
        ws.addEventListener("open", () => ws.send(JSON.stringify({ ...payload, req_id: 1 })));
        ws.addEventListener("message", event => {
            const message = JSON.parse(event.data);
            if (message.error) {
                window.clearTimeout(timeout);
                ws.close();
                reject(new Error(message.error.message));
            } else if (message.msg_type === "candles") {
                window.clearTimeout(timeout);
                ws.close();
                resolve(message);
            }
        });
        ws.addEventListener("error", () => {
            window.clearTimeout(timeout);
            reject(new Error("Deriv market-data connection failed"));
        });
    });
}
