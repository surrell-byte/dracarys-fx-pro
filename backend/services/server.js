import "dotenv/config";
import express from "express";
import cors from "cors";
import ccxt from "ccxt";
import { placeOrder } from "./trader.js";

const app = express();

// Restrict cross-origin access to an explicit allowlist. Set
// ALLOWED_ORIGINS as a comma-separated list in the environment
// (e.g. "https://your-frontend.vercel.app"). If unset, no browser
// origin is allowed by default (server-to-server calls without an
// Origin header, like curl/Vercel functions, still work).
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true); // non-browser clients
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Origin not allowed by CORS policy"));
    }
}));
app.use(express.json());

// Simple shared-secret auth for every route below. Set TRADE_API_KEY in
// the environment and send it as `x-api-key` on every request. This is
// not a substitute for a real auth system, but it stops the endpoint
// from being callable by anyone who finds the URL.
const apiKey = process.env.TRADE_API_KEY;

app.use((req, res, next) => {
    if (!apiKey) {
        // Fail closed: refuse to serve requests until an API key is configured.
        return res.status(503).json({ error: "Server misconfigured: TRADE_API_KEY is not set" });
    }
    if (req.get("x-api-key") !== apiKey) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
});

// Basic per-process rate limiting (sliding window, no external deps).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const requestLog = [];

app.use((req, res, next) => {
    const now = Date.now();
    while (requestLog.length && now - requestLog[0] > RATE_LIMIT_WINDOW_MS) {
        requestLog.shift();
    }
    if (requestLog.length >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: "Too many requests" });
    }
    requestLog.push(now);
    next();
});

const exchange = new ccxt.binance();

app.get("/candles", async (req, res) => {
    try {
        const symbol = req.query.symbol || "BTC/USDT";
        const timeframe = req.query.timeframe || "1m";
        const limit = parseInt(req.query.limit || "200");

        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);

        const formatted = ohlcv.map(c => ({
            time: c[0],
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5]
        }));

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Hard ceiling on order size regardless of what the caller requests.
// Set MAX_ORDER_QUANTITY in the environment to tune per-symbol; this is
// a last-resort safety net, not a sizing strategy.
const MAX_ORDER_QUANTITY = Number(process.env.MAX_ORDER_QUANTITY || 0.01);

function validateTradeRequest(body) {
    const errors = [];
    const validSignalTypes = new Set(["BUY", "SELL", "HOLD"]);
    const validModes = new Set(["dry-run", "live"]);

    if (!body.signal || !validSignalTypes.has(body.signal.type)) {
        errors.push("signal.type must be one of BUY, SELL, HOLD");
    }
    if (typeof body.symbol !== "string" || !/^[A-Z0-9]+\/[A-Z0-9]+$/.test(body.symbol)) {
        errors.push("symbol must look like BASE/QUOTE, e.g. BTC/USDT");
    }
    if (typeof body.quantity !== "number" || !(body.quantity > 0)) {
        errors.push("quantity must be a positive number");
    } else if (body.quantity > MAX_ORDER_QUANTITY) {
        errors.push(`quantity exceeds the configured maximum (${MAX_ORDER_QUANTITY})`);
    }
    if (body.mode !== undefined && !validModes.has(body.mode)) {
        errors.push("mode must be dry-run or live");
    }
    for (const field of ["stopLoss", "takeProfit"]) {
        if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "number") {
            errors.push(`${field} must be a number or null`);
        }
    }
    return errors;
}

app.post("/trade", async (req, res) => {
    // Global kill switch: even with a valid API key, live orders are
    // refused unless the operator has explicitly enabled them. This is
    // checked here (not just inside placeOrder) so it's the first thing
    // evaluated for any live-mode request.
    if (req.body.mode === "live" && process.env.LIVE_TRADING !== "true") {
        return res.status(403).json({ error: "Live trading is disabled on this server" });
    }

    const validationErrors = validateTradeRequest(req.body);
    if (validationErrors.length) {
        return res.status(400).json({ error: "Invalid trade request", details: validationErrors });
    }

    try {
        const result = await placeOrder({
            signal: req.body.signal,
            symbol: req.body.symbol,
            quantity: req.body.quantity,
            mode: req.body.mode,
            stopLoss: req.body.stopLoss ?? null,
            takeProfit: req.body.takeProfit ?? null
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const server = app.listen(3001, () => {
    console.log("🚀 Market API running on http://localhost:3001");
});

server.on("error", (err) => {
    console.error("Market API error:", err.message);
});