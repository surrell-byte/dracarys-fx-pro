// Pure decision functions for opening/closing virtual (paper) trades based
// on signalEngine output. No IO here on purpose — db.js and candles.js are
// the only modules that touch disk/network, so this logic can be unit
// tested and reasoned about on its own.

export function shouldOpen(signal) {
    return (signal.type === "BUY" || signal.type === "SELL") && signal.ready !== false;
}

// openTrade: { type, stopLoss, takeProfit, entryPrice }
//
// `candle` should be the latest *closed* candle ({ high, low, close }).
// Checking exits against just the close price misses intrabar moves: a
// candle can trade through both entry-adjacent levels within the same
// bar even though its close never gets there. Using high/low catches
// those hits, at the cost of an ambiguity when a single candle's range
// contains both the stop and the target — see `ambiguousFillRule` below.
//
// `ambiguousFillRule` controls which side wins when both stopLoss and
// takeProfit fall within one candle's [low, high] range:
//   "conservative" (default) - assume the stop was hit first
//   "optimistic"              - assume the target was hit first
export function checkExit(openTrade, candle, candlesSinceOpen, maxHoldCandles, ambiguousFillRule = "conservative") {
    const { type, stopLoss, takeProfit, entryPrice } = openTrade;
    const { high, low, close } = candle;

    const hasTP = Number.isFinite(takeProfit);
    const hasSL = Number.isFinite(stopLoss);

    const tpHit = type === "BUY"
        ? hasTP && high >= takeProfit
        : hasTP && low <= takeProfit;
    const slHit = type === "BUY"
        ? hasSL && low <= stopLoss
        : hasSL && high >= stopLoss;

    if (tpHit && slHit) {
        // Both levels were touched within this single candle - we can't
        // know from OHLC alone which came first. Resolve by policy rather
        // than silently picking one, so backtests/paper stats are honest
        // about this being an approximation.
        return ambiguousFillRule === "optimistic"
            ? buildClose("win", "take_profit", entryPrice, takeProfit, type)
            : buildClose("loss", "stop_loss", entryPrice, stopLoss, type);
    }
    if (tpHit) {
        return buildClose("win", "take_profit", entryPrice, takeProfit, type);
    }
    if (slHit) {
        return buildClose("loss", "stop_loss", entryPrice, stopLoss, type);
    }

    if (candlesSinceOpen >= maxHoldCandles) {
        const pnlPct = pnlPercent(type, entryPrice, close);
        return buildClose(pnlPct >= 0 ? "win" : "loss", "timeout", entryPrice, close, type, pnlPct);
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
