import "dotenv/config";
import express from "express";
import cors from "cors";
import ccxt from "ccxt";
import { placeOrder } from "./trader.js";

const app = express();
app.use(cors());
app.use(express.json());

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

app.post("/trade", async (req, res) => {
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