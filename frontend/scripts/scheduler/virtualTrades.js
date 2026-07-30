// Pure decision functions for opening/closing virtual (paper) trades based
// on signalEngine output. No IO here on purpose — db.js and candles.js are
// the only modules that touch disk/network, so this logic can be unit
// tested and reasoned about on its own.

export function shouldOpen(signal) {
    return (signal.type === "BUY" || signal.type === "SELL") && signal.ready !== false;
}

// openTrade: { type, stopLoss, takeProfit, entryPrice }
export function checkExit(openTrade, latestPrice, candlesSinceOpen, maxHoldCandles) {
    const { type, stopLoss, takeProfit, entryPrice } = openTrade;

    if (type === "BUY") {
        if (Number.isFinite(takeProfit) && latestPrice >= takeProfit) {
            return buildClose("win", "take_profit", entryPrice, latestPrice, type);
        }
        if (Number.isFinite(stopLoss) && latestPrice <= stopLoss) {
            return buildClose("loss", "stop_loss", entryPrice, latestPrice, type);
        }
    } else if (type === "SELL") {
        if (Number.isFinite(takeProfit) && latestPrice <= takeProfit) {
            return buildClose("win", "take_profit", entryPrice, latestPrice, type);
        }
        if (Number.isFinite(stopLoss) && latestPrice >= stopLoss) {
            return buildClose("loss", "stop_loss", entryPrice, latestPrice, type);
        }
    }

    if (candlesSinceOpen >= maxHoldCandles) {
        const pnlPct = pnlPercent(type, entryPrice, latestPrice);
        return buildClose(pnlPct >= 0 ? "win" : "loss", "timeout", entryPrice, latestPrice, type, pnlPct);
    }

    return null; // still open
}

function pnlPercent(type, entryPrice, exitPrice) {
    const raw = type === "BUY"
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;
    return raw * 100;
}

function buildClose(outcome, closeReason, entryPrice, exitPrice, type, precomputedPnl) {
    return {
        outcome,
        closeReason,
        exitPrice,
        pnlPct: precomputedPnl ?? pnlPercent(type, entryPrice, exitPrice)
    };
}
