#!/usr/bin/env bash
# 05-scorecard.sh
# Replaces frontend/src/js/analysis/scorecard.js wholesale with a
# pooled-trade scorecard (bootstrap CIs, real regime stats, market/timeframe
# matrices) instead of averaging per-fold stats.
set -euo pipefail

FILE="frontend/src/js/analysis/scorecard.js"
DIR="$(dirname "$FILE")"
mkdir -p "$DIR"

if [ -f "$FILE" ]; then
  cp "$FILE" "$FILE.bak"
  echo "Backed up existing file to $FILE.bak"
fi

cat > "$FILE" <<'EOF'
import { computeStrategyStats } from "@analysis/performanceStats.js";
import { wilsonInterval } from "@analysis/payoutMetrics.js";

function finite(values) {
    return values.filter((value) => Number.isFinite(value));
}

function average(values) {
    const valid = finite(values);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function median(values) {
    const valid = finite(values).slice().sort((a, b) => a - b);
    if (!valid.length) return null;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2 === 0 ? (valid[middle - 1] + valid[middle]) / 2 : valid[middle];
}

// Deterministic PRNG so bootstrap CIs are reproducible across runs —
// never use Math.random() for research output.
function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };
}

export function bootstrapMeanCI(trades, { iterations = 2000, seed = "dracarys" } = {}) {
    const values = trades.map((trade) => Number(trade.pnlPercent)).filter(Number.isFinite);
    if (!values.length) return null;
    if (values.length === 1) return { lower: values[0], upper: values[0] };

    const random = seededRandom(hashString(seed));
    const means = new Array(iterations);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        let total = 0;
        for (let i = 0; i < values.length; i += 1) {
            const index = Math.floor(random() * values.length);
            total += values[index];
        }
        means[iteration] = total / values.length;
    }

    means.sort((a, b) => a - b);
    const lowerIndex = Math.floor(iterations * 0.025);
    const upperIndex = Math.floor(iterations * 0.975);

    return {
        lower: means[Math.min(lowerIndex, means.length - 1)],
        upper: means[Math.min(upperIndex, means.length - 1)]
    };
}

export function flattenResearchTrades(report) {
    const trades = [];

    for (const result of report?.results ?? []) {
        if (result.error) continue;

        if (Array.isArray(result.trades)) {
            trades.push(
                ...result.trades.map((trade) => ({
                    ...trade,
                    symbol: trade.symbol ?? result.symbol,
                    assetClass: trade.assetClass ?? result.assetClass,
                    timeframe: trade.timeframe ?? result.timeframe
                }))
            );
            continue;
        }

        // Backwards-compatible fallback for older reports.
        for (const fold of result.folds ?? []) {
            for (const [strategy, strategyTrades] of Object.entries(fold.spotTradesByStrategy ?? {})) {
                for (const trade of strategyTrades) {
                    trades.push({
                        ...trade,
                        strategy,
                        symbol: result.symbol,
                        assetClass: result.assetClass,
                        timeframe: result.timeframe,
                        fold: fold.fold
                    });
                }
            }
        }
    }

    return trades.sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
}

function flattenFoldRows(report) {
    const rows = [];
    for (const result of report?.results ?? []) {
        if (result.error) continue;
        for (const row of result.rows ?? []) {
            rows.push({ ...row, symbol: row.symbol ?? result.symbol, timeframe: row.timeframe ?? result.timeframe });
        }
    }
    return rows;
}

function classifyStrategy({ trades, expectancy, expectancyCI, profitableFoldPct }) {
    if (trades < 30) return "INSUFFICIENT DATA";

    if (Number.isFinite(expectancyCI?.lower) && expectancyCI.lower > 0 && profitableFoldPct >= 60) {
        return "ROBUST";
    }
    if (Number.isFinite(expectancy) && expectancy > 0 && profitableFoldPct >= 50) {
        return "PROMISING";
    }
    if (Number.isFinite(expectancy) && expectancy > 0) {
        return "INCONSISTENT";
    }
    if (Number.isFinite(expectancyCI?.upper) && expectancyCI.upper < 0) {
        return "NEGATIVE";
    }
    return "WEAK";
}

function buildTradeGroupStats(trades, { groupKey, foldRows = [] }) {
    const orderedTrades = trades.slice().sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    const stats = computeStrategyStats(orderedTrades);
    const expectancyCI = bootstrapMeanCI(orderedTrades, { seed: `expectancy:${groupKey}` });

    // Fold-level PnL is used ONLY for consistency — profitability metrics
    // come from pooled trades, not averaged fold stats.
    const foldPnl = foldRows.map((row) => (Number.isFinite(row.totalPnl) ? row.totalPnl : 0));
    const profitableFolds = foldPnl.filter((pnl) => pnl > 0).length;
    const totalFolds = foldPnl.length;
    const profitableFoldPct = totalFolds ? (profitableFolds / totalFolds) * 100 : 0;

    const wins = orderedTrades.filter((trade) => Number(trade.pnlPercent) > 0).length;
    const winRateCI = orderedTrades.length ? wilsonInterval(wins, orderedTrades.length) : null;

    return {
        trades: stats.trades,
        totalPnl: stats.totalReturn,
        winRate: stats.winRate != null ? stats.winRate * 100 : null,
        winRateCI: winRateCI ? { lower: winRateCI.lower * 100, upper: winRateCI.upper * 100 } : null,
        expectancy: stats.expectancy,
        expectancyCI,
        profitFactor: stats.profitFactor,
        sharpe: stats.sharpe,
        sortino: stats.sortino,
        calmar: stats.calmar,
        maxDrawdown: stats.maxDrawdown,
        recoveryFactor: stats.recoveryFactor,
        longestLossStreak: stats.longestLossStreak,
        longestWinStreak: stats.longestWinStreak,
        avgWin: stats.avgWin,
        avgLoss: stats.avgLoss,
        profitableFolds,
        totalFolds,
        profitableFoldPct,
        medianFoldPnl: median(foldPnl),
        bestFoldPnl: foldPnl.length ? Math.max(...foldPnl) : null,
        worstFoldPnl: foldPnl.length ? Math.min(...foldPnl) : null,
        verdict: classifyStrategy({
            trades: stats.trades,
            expectancy: stats.expectancy,
            expectancyCI,
            profitableFoldPct
        })
    };
}

export function buildStrategyScorecard(reportOrRows) {
    const report = reportOrRows?.results ? reportOrRows : null;
    const trades = report ? flattenResearchTrades(report) : [];
    const rows = report ? flattenFoldRows(report) : Array.isArray(reportOrRows) ? reportOrRows : [];

    const strategies = new Set([
        ...trades.map((trade) => trade.strategy),
        ...rows.map((row) => row.strategy)
    ]);

    return [...strategies]
        .map((strategy) => {
            const strategyTrades = trades.filter((trade) => trade.strategy === strategy);
            const strategyRows = rows.filter((row) => row.strategy === strategy);
            const stats = buildTradeGroupStats(strategyTrades, {
                groupKey: `strategy:${strategy}`,
                foldRows: strategyRows
            });
            const label = strategyTrades.find((trade) => trade.label)?.label ?? strategy;

            return { strategy, label, ...stats };
        })
        .sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
}

export function buildAssetScorecard(report) {
    const trades = flattenResearchTrades(report);
    const groups = new Map();

    for (const trade of trades) {
        const key = trade.symbol ?? "UNKNOWN";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(trade);
    }

    return [...groups.entries()]
        .map(([symbol, symbolTrades]) => {
            const rows = flattenFoldRows(report).filter((row) => row.symbol === symbol);
            return { symbol, ...buildTradeGroupStats(symbolTrades, { groupKey: `asset:${symbol}`, foldRows: rows }) };
        })
        .sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
}

export function buildTimeframeScorecard(report) {
    const trades = flattenResearchTrades(report);
    const groups = new Map();

    for (const trade of trades) {
        const key = trade.timeframe ?? "UNKNOWN";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(trade);
    }

    return [...groups.entries()]
        .map(([timeframe, timeframeTrades]) => {
            const rows = flattenFoldRows(report).filter((row) => row.timeframe === timeframe);
            return {
                timeframe,
                ...buildTradeGroupStats(timeframeTrades, { groupKey: `timeframe:${timeframe}`, foldRows: rows })
            };
        })
        .sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
}

// Uses ACTUAL TRADE regimes, not the fold leaderboard's "most common regime"
// (which discards the regime of every individual trade).
export function buildRegimeScorecard(report) {
    const trades = flattenResearchTrades(report);
    const groups = new Map();

    for (const trade of trades) {
        const key = trade.regime ?? "UNKNOWN";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(trade);
    }

    return [...groups.entries()]
        .map(([regime, regimeTrades]) => ({
            regime,
            // Fold consistency isn't meaningful here unless the runner also
            // emits regime-by-fold rows, so we skip it for this grouping.
            ...buildTradeGroupStats(regimeTrades, { groupKey: `regime:${regime}`, foldRows: [] })
        }))
        .sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
}

export function buildStrategyMarketMatrix(report) {
    const trades = flattenResearchTrades(report);
    const rows = flattenFoldRows(report);
    const keys = new Set();

    for (const trade of trades) keys.add(`${trade.strategy}::${trade.symbol}`);

    return [...keys]
        .map((key) => {
            const [strategy, symbol] = key.split("::");
            const groupTrades = trades.filter((t) => t.strategy === strategy && t.symbol === symbol);
            const groupRows = rows.filter((r) => r.strategy === strategy && r.symbol === symbol);
            return {
                strategy, symbol,
                ...buildTradeGroupStats(groupTrades, { groupKey: `strategy-market:${key}`, foldRows: groupRows })
            };
        })
        .sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
}

export function buildStrategyTimeframeMatrix(report) {
    const trades = flattenResearchTrades(report);
    const rows = flattenFoldRows(report);
    const keys = new Set();

    for (const trade of trades) keys.add(`${trade.strategy}::${trade.timeframe}`);

    return [...keys]
        .map((key) => {
            const [strategy, timeframe] = key.split("::");
            const groupTrades = trades.filter((t) => t.strategy === strategy && t.timeframe === timeframe);
            const groupRows = rows.filter((r) => r.strategy === strategy && r.timeframe === timeframe);
            return {
                strategy, timeframe,
                ...buildTradeGroupStats(groupTrades, { groupKey: `strategy-timeframe:${key}`, foldRows: groupRows })
            };
        })
        .sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
}

export function buildResearchAudit(report) {
    return {
        generatedAt: new Date().toISOString(),
        strategyScorecard: buildStrategyScorecard(report),
        assetScorecard: buildAssetScorecard(report),
        timeframeScorecard: buildTimeframeScorecard(report),
        regimeScorecard: buildRegimeScorecard(report),
        strategyMarket: buildStrategyMarketMatrix(report),
        strategyTimeframe: buildStrategyTimeframeMatrix(report)
    };
}
EOF

echo "✓ Wrote $FILE"
