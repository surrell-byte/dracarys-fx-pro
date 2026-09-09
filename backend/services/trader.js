import ccxt from "ccxt";

const liveTradingEnabled = process.env.LIVE_TRADING === "true";

const client = new ccxt.binance({
    apiKey: process.env.BINANCE_KEY,
    secret: process.env.BINANCE_SECRET,
    enableRateLimit: true
});

function assertProtectiveLevels(side, entryPrice, stopLoss, takeProfit) {
    if (![entryPrice, stopLoss, takeProfit].every(Number.isFinite)) {
        throw new Error("Live orders require finite entry, stop-loss, and take-profit prices");
    }
    const valid = side === "buy"
        ? stopLoss < entryPrice && takeProfit > entryPrice
        : stopLoss > entryPrice && takeProfit < entryPrice;
    if (!valid) {
        throw new Error("Live stop-loss and take-profit must be on the correct side of entry");
    }
}

async function placeOcoExit({ symbol, side, quantity, stopLoss, takeProfit }) {
    await client.loadMarkets();
    const market = client.market(symbol);
    const exitSide = side === "buy" ? "sell" : "buy";
    const amount = client.amountToPrecision(symbol, quantity);
    const limitPrice = client.priceToPrecision(symbol, takeProfit);
    const stopPrice = client.priceToPrecision(symbol, stopLoss);

    // Binance spot OCO: the take-profit leg is a limit order and the
    // stop-loss leg is a stop-limit order. Both legs cancel each other.
    return client.privatePostOrderListOco({
        symbol: market.id,
        side: exitSide.toUpperCase(),
        quantity: amount,
        price: limitPrice,
        stopPrice,
        stopLimitPrice: stopPrice,
        stopLimitTimeInForce: "GTC"
    });
}

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

    assertProtectiveLevels(side, Number(signal.price), stopLoss, takeProfit);

    const order = await client.createMarketOrder(symbol, side, quantity);
    const filledQuantity = Number(order.filled ?? order.amount ?? quantity);
    const entryPrice = Number(order.average ?? order.price ?? signal.price);
    assertProtectiveLevels(side, entryPrice, stopLoss, takeProfit);

    try {
        const protection = await placeOcoExit({
            symbol,
            side,
            quantity: filledQuantity,
            stopLoss,
            takeProfit
        });

        return {
            ...order,
            stopLoss,
            takeProfit,
            protection,
            protectionStatus: "exchange_oco_placed"
        };
    } catch (error) {
        // Never leave an unprotected spot position open after an OCO failure.
        try {
            await client.createMarketOrder(symbol, side === "buy" ? "sell" : "buy", filledQuantity);
        } catch (rollbackError) {
            throw new Error(`Protective OCO failed (${error.message}); emergency flatten also failed (${rollbackError.message})`);
        }
        throw new Error(`Protective OCO failed; entry was flattened: ${error.message}`);
    }

}

export { assertProtectiveLevels };