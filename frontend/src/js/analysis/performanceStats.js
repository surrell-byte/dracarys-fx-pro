// performanceStats.js: turns a raw list of trade PnL% outcomes into the
// "professional" stats flagged in the review - expectancy, drawdown,
// risk-adjusted return, streaks, and sample confidence. One shared module
// so the backtest leaderboard, the live paper-trading leaderboard, and any
// future reporting all compute these identically instead of drifting.
//
// Every function here is pure and takes a plain array of trades shaped
// like `{ pnlPercent: number, closedAt?: number }` (closedAt in ms epoch,
// optional - only needed for time-bucketed stats). Nothing here touches
// storage or the DOM.

import { wilsonInterval } from "@analysis/payoutMetrics.js";

// Core expectancy/profit-factor numbers. Profit factor and "expectancy per
// trade" are the two numbers that actually answer "is this worth trading",
// more than win rate alone - a 30%-win-rate strategy can still be+EV if
// wins are big enough relative to losses (see avgWin/avgLoss below).
export function computeExpectancy(trades) {
    const n = trades.length;
    if (!n) {
        return {
            trades: 0, winRate: null, avgWin: null, avgLoss: null,
            expectancy: null, profitFactor: null, grossProfit: 0, grossLoss: 0
        };
    }

    const wins = trades.filter((t) => t.pnlPercent > 0);
    const losses = trades.filter((t) => t.pnlPercent < 0);
    const grossProfit = wins.reduce((sum, t) => sum + t.pnlPercent, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0));

    const winRate = wins.length / n;
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;

    // Expectancy per trade, in the same % units as pnlPercent: what you'd
    // expect to make on average on the NEXT trade, given this track record.
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

    // profitFactor = gross wins / gross losses. >1 means net profitable;
    // null (not Infinity) when there are zero losses, since "infinite
    // profit factor" from a small sample is a data-scarcity artifact, not
    // a real result worth displaying as a number.
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);

    return { trades: n, winRate, avgWin, avgLoss, expectancy, profitFactor, grossProfit, grossLoss };
}

// Drawdown on the running equity curve built by summing pnlPercent trade
// by trade, in the order given (caller is responsible for chronological
// ordering - these numbers are meaningless out of sequence). Also returns
// a recovery factor: total return divided by max drawdown, i.e. "how many
// times did the strategy earn back its worst dip".
export function computeDrawdownStats(trades) {
    if (!trades.length) {
        return { maxDrawdown: 0, avgDrawdown: 0, recoveryFactor: null, totalReturn: 0 };
    }

    let running = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let drawdownSum = 0;
    let drawdownSamples = 0;

    trades.forEach((t) => {
        running += t.pnlPercent;
        peak = Math.max(peak, running);
        const drawdown = peak - running;
        if (drawdown > 0) {
            drawdownSum += drawdown;
            drawdownSamples += 1;
        }
        maxDrawdown = Math.max(maxDrawdown, drawdown);
    });

    const totalReturn = running;
    const avgDrawdown = drawdownSamples ? drawdownSum / drawdownSamples : 0;
    const recoveryFactor = maxDrawdown > 0 ? totalReturn / maxDrawdown : null;

    return { maxDrawdown, avgDrawdown, recoveryFactor, totalReturn };
}

// Sharpe/Sortino/Calmar, computed per-trade rather than per-time-period
// (this system doesn't have a fixed bar interval for returns the way a
// daily-NAV fund would) - so treat these as relative comparison numbers
// between strategies in the SAME backtest, not as literal annualized
// figures you'd quote externally. riskFreeRate defaults to 0 (per-trade
// risk-free return is a rounding error at any real trade frequency).
export function computeRiskAdjustedReturns(trades, { riskFreeRate = 0 } = {}) {
    const n = trades.length;
    if (n < 2) return { sharpe: null, sortino: null, calmar: null };

    const returns = trades.map((t) => t.pnlPercent - riskFreeRate);
    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (n - 1);
    const stdDev = Math.sqrt(variance);

    const downside = returns.filter((r) => r < 0);
    const downsideVariance = downside.length
        ? downside.reduce((sum, r) => sum + r ** 2, 0) / downside.length
        : 0;
    const downsideDev = Math.sqrt(downsideVariance);

    const sharpe = stdDev > 0 ? mean / stdDev : null;
    const sortino = downsideDev > 0 ? mean / downsideDev : (downside.length ? null : Infinity);

    const { maxDrawdown, totalReturn } = computeDrawdownStats(trades);
    const calmar = maxDrawdown > 0 ? totalReturn / maxDrawdown : null;

    return {
        sharpe,
        sortino: Number.isFinite(sortino) ? sortino : null,
        calmar
    };
}

// Longest consecutive win/loss run, in trade order. A strategy with a
// deceptively good average can still be unsurvivable to actually trade if
// its longest losing streak would have blown past a real risk budget.
export function computeStreaks(trades) {
    let longestWin = 0, longestLoss = 0, currentWin = 0, currentLoss = 0;

    trades.forEach((t) => {
        if (t.pnlPercent > 0) {
            currentWin += 1;
            currentLoss = 0;
        } else if (t.pnlPercent < 0) {
            currentLoss += 1;
            currentWin = 0;
        } else {
            currentWin = 0;
            currentLoss = 0;
        }
        longestWin = Math.max(longestWin, currentWin);
        longestLoss = Math.max(longestLoss, currentLoss);
    });

    return { longestWinStreak: longestWin, longestLossStreak: longestLoss };
}

// Wilson-interval sample confidence on win rate (reuses the same math the
// binary-options edge calculator already trusts) - "reliable: false" below
// some minimum sample size, same convention as payoutMetrics.evaluateEdge.
export function computeSampleConfidence(trades, { minSampleSize = 20, z = 1.96 } = {}) {
    const n = trades.length;
    const wins = trades.filter((t) => t.pnlPercent > 0).length;
    const reliable = n >= minSampleSize;
    const ci = n > 0 ? wilsonInterval(wins, n, z) : null;
    return {
        trades: n,
        reliable,
        minSampleSize,
        confidenceInterval: ci ? { lower: ci.lower * 100, upper: ci.upper * 100 } : null
    };
}

// One-stop aggregator: everything above, bundled per strategy, for a
// leaderboard row. Trades must already be in chronological order.
export function computeStrategyStats(trades, options = {}) {
    const expectancyStats = computeExpectancy(trades);
    const drawdownStats = computeDrawdownStats(trades);
    const riskAdjusted = computeRiskAdjustedReturns(trades, options);
    const streaks = computeStreaks(trades);
    const sampleConfidence = computeSampleConfidence(trades, options);

    return {
        ...expectancyStats,
        ...drawdownStats,
        ...riskAdjusted,
        ...streaks,
        sampleConfidence
    };
}

// Rolling performance over the trailing N trades (not calendar time) -
// answers "is this strategy's edge stable, or was it all front-loaded /
// back-loaded". Returns one totalPnl number per window, sliding by
// `step` trades at a time.
export function computeRollingPerformance(trades, windowSize = 50, step = 10) {
    if (trades.length < windowSize) return [];
    const windows = [];
    for (let start = 0; start + windowSize <= trades.length; start += step) {
        const slice = trades.slice(start, start + windowSize);
        const totalPnl = slice.reduce((sum, t) => sum + t.pnlPercent, 0);
        windows.push({
            startIndex: start,
            endIndex: start + windowSize - 1,
            totalPnl,
            winRate: (slice.filter((t) => t.pnlPercent > 0).length / windowSize) * 100
        });
    }
    return windows;
}
