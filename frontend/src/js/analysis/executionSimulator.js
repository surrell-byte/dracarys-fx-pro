// frontend/src/js/analysis/executionSimulator.js
//
// Shared execution simulation for backtests, paper trading, and future
// exchange-side replay. This keeps SL/TP/timeout/ambiguous-candle handling
// in one canonical place, so live and research outcomes stay aligned.

import {
    applyEntryCost,
    applyExitCost,
    applyFeeToPnl
} from "./executionCosts.js";

function validateFinite(name, value) {
    if (!Number.isFinite(value)) {
        throw new Error(`${name} must be a finite number.`);
    }
}

function calculateRawPnlPct(type, entryPrice, exitPrice) {
    if (type === "BUY") {
        return ((exitPrice - entryPrice) / entryPrice) * 100;
    }

    if (type === "SELL") {
        return ((entryPrice - exitPrice) / entryPrice) * 100;
    }

    throw new Error(`Unsupported position type: ${type}`);
}

export function normalizeAmbiguousFillRule(rule = "close-biased") {
    return rule === "optimistic" || rule === "conservative" || rule === "close-biased"
        ? rule
        : "close-biased";
}

export function normalizeCloseReason(reason = "unknown") {
    const normalized = String(reason ?? "unknown").trim().toLowerCase();
    if (["end_of_data", "end of data", "expired", "timeout", "time_out"].includes(normalized)) {
        return "timeout";
    }
    if (["stoploss", "stop_loss", "sl", "stopped", "stopLoss"].includes(normalized)) {
        return "stop_loss";
    }
    if (["takeprofit", "take_profit", "tp", "target", "takeProfit"].includes(normalized)) {
        return "take_profit";
    }
    return normalized || "unknown";
}

function finaliseExit({
    position,
    rawExitPrice,
    closeReason,
    candleTime,
    assetClass,
    costs
}) {
    const {
        type,
        entryPrice,
        rawEntryPrice = entryPrice
    } = position;

    const exitPrice =
        applyExitCost(
            rawExitPrice,
            type,
            assetClass,
            costs
        );

    /*
     * GROSS:
     *
     * Uses the actual raw market entry and raw market exit.
     * No spread, slippage or fees.
     */
    const grossPnlPct =
        calculateRawPnlPct(
            type,
            rawEntryPrice,
            rawExitPrice
        );

    /*
     * NET:
     *
     * Uses the execution-adjusted entry/exit and fees.
     */
    const rawNetPnlPct =
        calculateRawPnlPct(
            type,
            entryPrice,
            exitPrice
        );

    const pnlPct =
        applyFeeToPnl(
            rawNetPnlPct,
            assetClass,
            costs
        );

    return {
        outcome: pnlPct >= 0 ? "win" : "loss",

        closeReason: normalizeCloseReason(closeReason),

        rawExitPrice,

        exitPrice,

        grossPnlPercent: grossPnlPct,

        pnlPct,

        costDragPercent:
            pnlPct - grossPnlPct,

        timestamp:
            candleTime ?? null
    };
}

export function createEntryFill({ signal, assetClass = "crypto", costs = null }) {
    if (!signal) {
        throw new Error("Signal is required.");
    }
    if (!["BUY", "SELL"].includes(signal.type)) {
        throw new Error(`Unsupported signal type: ${signal.type}`);
    }
    validateFinite("signal.price", signal.price);
    return applyEntryCost(signal.price, signal.type, assetClass, costs);
}

export function evaluateCandleExit({
    position,
    candle,
    candlesSinceOpen = 0,
    maxHoldCandles = Infinity,
    ambiguousFillRule = "close-biased",
    assetClass = "crypto",
    costs = null
}) {
    const resolvedAmbiguousFillRule = normalizeAmbiguousFillRule(ambiguousFillRule);

    if (!position || !candle) return null;
    validateFinite("position.entryPrice", position.entryPrice);
    validateFinite("candle.high", Number(candle.high));
    validateFinite("candle.low", Number(candle.low));
    validateFinite("candle.close", Number(candle.close));

    const {
        type,
        entryPrice,
        stopLoss,
        takeProfit
    } = position;

    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);

    const hasStopLoss = Number.isFinite(stopLoss);
    const hasTakeProfit = Number.isFinite(takeProfit);

    const stopHit = type === "BUY"
        ? hasStopLoss && low <= stopLoss
        : hasStopLoss && high >= stopLoss;

    const targetHit = type === "BUY"
        ? hasTakeProfit && high >= takeProfit
        : hasTakeProfit && low <= takeProfit;

    if (stopHit && targetHit) {
        if (resolvedAmbiguousFillRule === "optimistic") {
            return finaliseExit({
                position,
                rawExitPrice: takeProfit,
                closeReason: "take_profit",
                candleTime: candle.time,
                assetClass,
                costs
            });
        }

        if (resolvedAmbiguousFillRule === "close-biased") {
            const closesOnTakeProfitSide = type === "BUY"
                ? close >= takeProfit
                : close <= takeProfit;

            return finaliseExit({
                position,
                rawExitPrice: closesOnTakeProfitSide ? takeProfit : stopLoss,
                closeReason: closesOnTakeProfitSide ? "take_profit" : "stop_loss",
                candleTime: candle.time,
                assetClass,
                costs
            });
        }

        return finaliseExit({
            position,
            rawExitPrice: stopLoss,
            closeReason: "stop_loss",
            candleTime: candle.time,
            assetClass,
            costs
        });
    }

    if (targetHit) {
        return finaliseExit({
            position,
            rawExitPrice: takeProfit,
            closeReason: "take_profit",
            candleTime: candle.time,
            assetClass,
            costs
        });
    }

    if (stopHit) {
        return finaliseExit({
            position,
            rawExitPrice: stopLoss,
            closeReason: "stop_loss",
            candleTime: candle.time,
            assetClass,
            costs
        });
    }

    if (Number.isFinite(maxHoldCandles) && candlesSinceOpen >= maxHoldCandles) {
        return finaliseExit({
            position,
            rawExitPrice: close,
            closeReason: "timeout",
            candleTime: candle.time,
            assetClass,
            costs
        });
    }

    return null;
}
