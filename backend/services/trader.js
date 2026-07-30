import ccxt from "ccxt";

const liveTradingEnabled = process.env.LIVE_TRADING === "true";

const client = new ccxt.binance({
    apiKey: process.env.BINANCE_KEY,
    secret: process.env.BINANCE_SECRET,
    enableRateLimit: true
});

export async function placeOrder({
    signal,
    symbol = "BTC/USDT",
    quantity = 0.001,
    mode = "dry-run",
    stopLoss = null,
    takeProfit = null
}) {
    const side = signal?.type === "BUY" ? "buy" : signal?.type === "SELL" ? "sell" : null;

    if (!side) {
        return {
            status: "skipped",
            reason: "Signal is HOLD or invalid"
        };
    }

    if (mode !== "live" || !liveTradingEnabled) {
        return {
            status: mode === "live" ? "blocked" : "dry-run",
            side,
            symbol,
            quantity,
            stopLoss,
            takeProfit,
            reason: mode === "live"
                ? "Set LIVE_TRADING=true with Binance credentials to place real orders"
                : "Dry-run mode does not place real orders"
        };
    }

    if (!process.env.BINANCE_KEY || !process.env.BINANCE_SECRET) {
        throw new Error("Missing BINANCE_KEY or BINANCE_SECRET");
    }

    // NOTE: this places a plain market order only. stopLoss/takeProfit are
    // NOT attached as real exchange bracket/OCO orders — Binance spot market
    // orders don't support that here, and building real OCO order placement
    // is a separate piece of work. They're returned below so the caller can
    // display them and manage the exit manually (or via the paper engine,
    // which does enforce them automatically).
    const order = await client.createMarketOrder(symbol, side, quantity);

    return {
        ...order,
        stopLoss,
        takeProfit,
        stopLossNote: "Informational only — not placed on the exchange"
    };
}