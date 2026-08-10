// Pure decision functions for opening/closing virtual (paper) trades based
// on signalEngine output. No IO here on purpose — db.js and candles.js are
// the only modules that touch disk/network, so this logic can be unit
// tested and reasoned about on its own.

import { applyExitCost, applyFeeToPnl } from "@analysis/executionCosts.js";

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
//
// `assetClass`/`costs` feed the shared execution-cost model: the exit
// price recorded is the realistic filled price (spread + slippage), and
// the final PnL has the round-trip fee subtracted. The stop/take-profit
// *levels* used to decide whether an exit fires stay untouched — costs
// only affect what price you actually get once an exit condition is
// already true, matching how a real broker fill works (costs affect the
// fill price you receive, not whether your order would have triggered).
export function checkExit(openTrade, candle, candlesSinceOpen, maxHoldCandles, ambiguousFillRule = "conservative", assetClass = "crypto", costs = null) {
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
            ? buildClose("win", "take_profit", entryPrice, takeProfit, type, assetClass, costs)
            : buildClose("loss", "stop_loss", entryPrice, stopLoss, type, assetClass, costs);
    }
    if (tpHit) {
        return buildClose("win", "take_profit", entryPrice, takeProfit, type, assetClass, costs);
    }
    if (slHit) {
        return buildClose("loss", "stop_loss", entryPrice, stopLoss, type, assetClass, costs);
    }

    if (candlesSinceOpen >= maxHoldCandles) {
        const filledExit = applyExitCost(close, type, assetClass, costs);
        const pnlPct = applyFeeToPnl(pnlPercent(type, entryPrice, filledExit), assetClass, costs);
        return buildClose(pnlPct >= 0 ? "win" : "loss", "timeout", entryPrice, close, type, assetClass, costs, pnlPct, filledExit);
    }

    return null; // still open
}

function pnlPercent(type, entryPrice, exitPrice) {
    const raw = type === "BUY"
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;
    return raw * 100;
}

// `rawExitPrice` is the level that triggered the exit (stop/target/close);
// the actual filled/reported exit price has spread+slippage applied on
// top of it, and the reported PnL has the round-trip fee subtracted.
// `precomputedPnl`/`precomputedFilledExit` let the timeout path (which
// already computed both above) skip redoing the work.
function buildClose(outcome, closeReason, entryPrice, rawExitPrice, type, assetClass, costs, precomputedPnl, precomputedFilledExit) {
    const filledExit = precomputedFilledExit ?? applyExitCost(rawExitPrice, type, assetClass, costs);
    const pnlPct = precomputedPnl ?? applyFeeToPnl(pnlPercent(type, entryPrice, filledExit), assetClass, costs);
    return {
        outcome,
        closeReason,
        exitPrice: filledExit,
        pnlPct
    };
}
