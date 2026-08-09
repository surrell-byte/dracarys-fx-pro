// Portfolio-level gate that sits between "a strategy wants to open a
// trade" and "a trade actually gets opened". Previously the scheduler's
// only stacking check was "same symbol + same strategy" - which meant 14
// strategies across 4 symbols could independently agree on the same
// directional bet and open up to 56 simultaneous virtual positions, all
// effectively the same trade repeated, with the leaderboard/reporting
// treating each as an independent data point.
//
// This module is pure (no IO) so it can be unit tested: pass it the
// currently open trades (as returned by db.getAllOpenSignals()) and the
// candidate new trade, get back an allow/deny decision with a reason.

const DEFAULT_LIMITS = {
    maxConcurrentPositions: 20,     // hard ceiling across the whole portfolio
    maxPositionsPerSymbol: 4,       // e.g. don't stack 14 strategies onto one pair
    maxPositionsPerDirection: 12,   // don't let one directional thesis dominate
    maxDailyLossPct: null          // e.g. -5 to stop opening new trades after a -5% day
};

export function evaluatePortfolioRisk(candidate, openTrades, todaysClosedTrades = [], limits = {}) {
    const cfg = { ...DEFAULT_LIMITS, ...limits };
    const reasons = [];

    if (openTrades.length >= cfg.maxConcurrentPositions) {
        reasons.push(`at max concurrent positions (${cfg.maxConcurrentPositions})`);
    }

    const sameSymbolCount = openTrades.filter((t) => t.symbol === candidate.symbol).length;
    if (sameSymbolCount >= cfg.maxPositionsPerSymbol) {
        reasons.push(`at max positions for ${candidate.symbol} (${cfg.maxPositionsPerSymbol})`);
    }

    const sameDirectionCount = openTrades.filter((t) => t.type === candidate.type).length;
    if (sameDirectionCount >= cfg.maxPositionsPerDirection) {
        reasons.push(`at max ${candidate.type} positions across the portfolio (${cfg.maxPositionsPerDirection})`);
    }

    if (cfg.maxDailyLossPct != null) {
        const todaysPnlPct = todaysClosedTrades.reduce((sum, t) => sum + (t.pnl_pct ?? 0), 0);
        if (todaysPnlPct <= cfg.maxDailyLossPct) {
            reasons.push(`daily loss limit hit (${todaysPnlPct.toFixed(2)}% <= ${cfg.maxDailyLossPct}%)`);
        }
    }

    return {
        allowed: reasons.length === 0,
        reasons
    };
}
