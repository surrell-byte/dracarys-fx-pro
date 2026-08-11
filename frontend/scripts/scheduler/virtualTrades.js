// Pure decision functions for opening/closing virtual (paper) trades based
// on signalEngine output. No IO here on purpose — db.js and candles.js are
// the only modules that touch disk/network, so this logic can be unit
// tested and reasoned about on its own.

import { evaluateCandleExit } from "@analysis/executionSimulator.js";

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
    return evaluateCandleExit({
        position: {
            type: openTrade.type,
            entryPrice: openTrade.entryPrice,
            stopLoss: openTrade.stopLoss,
            takeProfit: openTrade.takeProfit
        },
        candle,
        candlesSinceOpen,
        maxHoldCandles,
        ambiguousFillRule,
        assetClass,
        costs
    });
}
