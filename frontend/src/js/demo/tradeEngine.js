// tradeEngine.js: the only place that opens/closes positions against the
// demo account. app.js calls these instead of touching demoAccount's
// trades array directly, so every win/loss always flows through the same
// PnL math, streak tracking, drawdown update, journal entry, and history
// record — there's no code path where a trade can close without updating
// the stats.

import demo from "./demoAccount.js";
import { addJournalEntry } from "./journal.js";
import { recordClosedTrade } from "./tradeHistory.js";
import { recomputeStrategyStats } from "./analytics.js";

let counter = 0;
function nextId() {
    counter += 1;
    return `trade_${Date.now()}_${counter}`;
}

/**
 * Opens a new demo position. Returns the trade object (with its id).
 */
export function openPosition({ symbol, strategy, side, entryPrice, quantity, stopLoss, takeProfit, confidence, reason }) {
    if (!symbol || !side || !Number.isFinite(entryPrice) || !Number.isFinite(quantity) || quantity <= 0) {
        return null;
    }

    const acc = demo.get();
    const trade = {
        id: nextId(),
        symbol,
        strategy: strategy ?? "unknown",
        side, // "long" | "short"
        entryPrice,
        quantity,
        stopLoss: Number.isFinite(stopLoss) ? stopLoss : null,
        takeProfit: Number.isFinite(takeProfit) ? takeProfit : null,
        confidence: Number.isFinite(confidence) ? confidence : null,
        reason: reason ?? "",
        openedAt: Date.now()
    };

    acc.trades.push(trade);
    demo.recalcMargin();
    demo.save();
    return trade;
}

/**
 * Closes an open position by id at exitPrice, realizes PnL into balance,
 * updates win/loss + streak + drawdown stats, and logs the trade to both
 * the history table and the narrative journal. Returns the closed trade
 * record, or null if the id wasn't found.
 */
export function closePosition(id, exitPrice, exitReason = "") {
    const acc = demo.get();
    const idx = acc.trades.findIndex((t) => t.id === id);
    if (idx === -1 || !Number.isFinite(exitPrice)) return null;

    const trade = acc.trades[idx];
    const pnl = trade.side === "long"
        ? (exitPrice - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - exitPrice) * trade.quantity;

    acc.trades.splice(idx, 1);
    acc.balance += pnl;

    if (pnl >= 0) {
        acc.wins += 1;
        acc.streak = acc.streak > 0 ? acc.streak + 1 : 1;
        acc.longestWinStreak = Math.max(acc.longestWinStreak, acc.streak);
    } else {
        acc.losses += 1;
        acc.streak = acc.streak < 0 ? acc.streak - 1 : -1;
        acc.longestLoseStreak = Math.max(acc.longestLoseStreak, Math.abs(acc.streak));
    }

    demo.recalcMargin();
    // Settle equity back to the realized balance now; if other positions
    // are still open, the next price tick's markToMarket call re-adds their
    // unrealized PnL on top.
    acc.equity = acc.balance;
    demo.updateDrawdown();

    const closed = { ...trade, exitPrice, pnl: Number(pnl.toFixed(2)), exitReason, closedAt: Date.now() };
    acc.closedTrades.unshift(closed);
    acc.closedTrades = acc.closedTrades.slice(0, 300);

    recomputeStrategyStats(acc);
    demo.save();

    recordClosedTrade(closed);
    addJournalEntry(closed);

    return closed;
}

/** Closes every open position on a given symbol (e.g. on market switch). */
export function closeAllForSymbol(symbol, exitPrice, exitReason = "Market switched") {
    const acc = demo.get();
    return acc.trades
        .filter((t) => t.symbol === symbol)
        .map((t) => closePosition(t.id, exitPrice, exitReason))
        .filter(Boolean);
}

export function getOpenPositionFor(symbol) {
    return demo.get().trades.find((t) => t.symbol === symbol) ?? null;
}
