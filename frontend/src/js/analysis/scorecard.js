// frontend/src/js/analysis/scorecard.js
//
// Turns individual walk-forward rows (one row per strategy per fold, as
// produced by scripts/analysis/multiMarketWalkForward.js) into research
// scorecards grouped by strategy, regime, and asset. Pure/stateless.

function average(values) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function median(values) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    const middle = Math.floor(valid.length / 2);
    if (valid.length % 2 === 0) {
        return (valid[middle - 1] + valid[middle]) / 2;
    }
    return valid[middle];
}

function consistencyScore(values) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return 0;
    const positive = valid.filter((value) => value > 0).length;
    return (positive / valid.length) * 100;
}

/**
 * Takes individual walk-forward rows and produces a strategy-level
 * research scorecard.
 *
 * Each row is expected to look like:
 *   { strategy, trades, winRate, totalPnl, expectancy, profitFactor, sharpe }
 */
export function buildStrategyScorecard(rows) {
    const byStrategy = new Map();

    for (const row of rows) {
        if (!row || row.strategy == null) continue;
        if (!byStrategy.has(row.strategy)) byStrategy.set(row.strategy, []);
        byStrategy.get(row.strategy).push(row);
    }

    return [...byStrategy.entries()]
        .map(([strategy, records]) => {
            const expectancies = records.map((r) => r.expectancy);
            const profitFactors = records.map((r) => r.profitFactor);
            const sharpes = records.map((r) => r.sharpe);
            const winRates = records.map((r) => r.winRate);

            return {
                strategy,
                samples: records.length,
                totalTrades: records.reduce((sum, r) => sum + (r.trades ?? 0), 0),
                avgExpectancy: average(expectancies),
                medianExpectancy: median(expectancies),
                avgProfitFactor: average(profitFactors),
                avgSharpe: average(sharpes),
                avgWinRate: average(winRates),
                expectancyConsistency: consistencyScore(expectancies),
                profitableFolds: expectancies.filter(
                    (value) => Number.isFinite(value) && value > 0
                ).length,
                profitableFoldPct: consistencyScore(expectancies)
            };
        })
        .sort((a, b) => (b.avgExpectancy ?? -Infinity) - (a.avgExpectancy ?? -Infinity));
}

/**
 * Group scorecard rows by market regime. Rows need a `regime` field;
 * everything falls into "UNKNOWN" if that isn't set yet — safe, not
 * useful until regime detection is wired into the row-producing side.
 */
export function buildRegimeScorecard(rows) {
    const groups = new Map();

    for (const row of rows) {
        if (!row) continue;
        const regime = row.regime ?? "UNKNOWN";
        if (!groups.has(regime)) groups.set(regime, []);
        groups.get(regime).push(row);
    }

    return [...groups.entries()]
        .map(([regime, records]) => ({
            regime,
            samples: records.length,
            totalTrades: records.reduce((sum, r) => sum + (r.trades ?? 0), 0),
            avgExpectancy: average(records.map((r) => r.expectancy)),
            avgProfitFactor: average(records.map((r) => r.profitFactor)),
            avgWinRate: average(records.map((r) => r.winRate))
        }))
        .sort((a, b) => (b.avgExpectancy ?? -Infinity) - (a.avgExpectancy ?? -Infinity));
}

/**
 * Group by symbol / asset. Rows need a `symbol` field — the walk-forward
 * runner stamps this on per fold row for you (see multiMarketWalkForward.js).
 */
export function buildAssetScorecard(rows) {
    const groups = new Map();

    for (const row of rows) {
        if (!row) continue;
        const key = row.symbol ?? "UNKNOWN";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }

    return [...groups.entries()]
        .map(([symbol, records]) => ({
            symbol,
            samples: records.length,
            totalTrades: records.reduce((sum, r) => sum + (r.trades ?? 0), 0),
            avgExpectancy: average(records.map((r) => r.expectancy)),
            avgProfitFactor: average(records.map((r) => r.profitFactor)),
            avgWinRate: average(records.map((r) => r.winRate))
        }))
        .sort((a, b) => (b.avgExpectancy ?? -Infinity) - (a.avgExpectancy ?? -Infinity));
}
