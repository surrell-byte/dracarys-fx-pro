// analytics.js: pure derived stats computed from the demo account's real
// closed trades. Nothing here mutates balance/wins/losses — that's
// tradeEngine's job. This module just reads acc.closedTrades and shapes it
// for the UI (per-strategy leaderboard, profit factor, expectancy, equity
// curve for a sparkline).

import demo from "./demoAccount.js";

// Rebuilds acc.strategyStats from acc.closedTrades. Called by tradeEngine
// right after a trade closes, so strategyStats never has to be trusted as
// independently-maintained state — it's always a fresh rollup.
export function recomputeStrategyStats(acc = demo.get()) {
    const stats = {};
    for (const t of acc.closedTrades) {
        const key = t.strategy || "unknown";
        if (!stats[key]) stats[key] = { trades: 0, wins: 0, losses: 0, totalPnl: 0 };
        stats[key].trades += 1;
        if (t.pnl >= 0) stats[key].wins += 1;
        else stats[key].losses += 1;
        stats[key].totalPnl += t.pnl;
    }
    acc.strategyStats = stats;
    return stats;
}

export function getStrategyLeaderboard() {
    const stats = demo.get().strategyStats || {};
    return Object.entries(stats)
        .map(([strategy, s]) => ({
            strategy,
            trades: s.trades,
            winRate: s.trades ? (s.wins / s.trades) * 100 : 0,
            totalPnl: s.totalPnl,
            avgPnl: s.trades ? s.totalPnl / s.trades : 0
        }))
        .sort((a, b) => b.totalPnl - a.totalPnl);
}

export function getProfitFactor() {
    const trades = demo.get().closedTrades;
    const grossProfit = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
    return grossProfit / grossLoss;
}

export function getExpectancy() {
    const acc = demo.get();
    const total = acc.wins + acc.losses;
    if (!total) return 0;
    return demo.getNetProfit() / total;
}

// Reconstructs a running-balance series from closed trades for a simple
// equity sparkline. Oldest trade first.
export function getEquityCurve(limit = 60) {
    const acc = demo.get();
    const ordered = acc.closedTrades.slice(0, limit).slice().reverse();
    let running = acc.startingBalance;
    return ordered.map((t) => {
        running += t.pnl;
        return { time: t.closedAt, balance: running };
    });
}
