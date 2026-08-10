// Backtest results tables: the single-run leaderboard + binary-stats
// tables, and the walk-forward per-fold comparison table. Extracted
// byte-identical from app.js. Note renderWalkForwardResults never
// actually used its `interval` parameter in the original - that's
// preserved here by simply not declaring it, rather than threading an
// unused value through for appearances.
import { formatNumber, formatSigned } from "@core/format.js";
import { expiryLabel, edgeClass, verdictClass } from "@core/labels.js";

function pnlDirection(value) {
    return value < 0 ? "loss" : value > 0 ? "gain" : "flat";
}

export function renderBacktestResults(elements, result, interval) {
    if (elements.backtestLeaderboardBody) {
        elements.backtestLeaderboardBody.innerHTML = result.spotLeaderboard.length
            ? result.spotLeaderboard.map(row => `
                <tr>
                    <td>${row.label}</td>
                    <td>${row.trades}</td>
                    <td>${formatNumber(row.winRate, 1)}%</td>
                    <td data-pnl="${pnlDirection(row.totalPnl)}">${formatSigned(row.totalPnl)}%</td>
                    <td>${formatSigned(row.avgPnl)}%</td>
                    <td>${row.expectancy != null ? formatSigned(row.expectancy) + "%" : "--"}</td>
                    <td>${row.profitFactor != null ? row.profitFactor.toFixed(2) : "--"}</td>
                    <td>${formatNumber(row.maxDrawdown, 1)}%</td>
                    <td>${row.sharpe != null ? row.sharpe.toFixed(2) : "--"}</td>
                    <td>${!row.sampleReliable
                        ? `<span class="empty-history">n=${row.trades}, too few</span>`
                        : row.winRateConfidenceInterval
                            ? `${formatNumber(row.winRateConfidenceInterval.lower, 0)}–${formatNumber(row.winRateConfidenceInterval.upper, 0)}%`
                            : "--"}</td>
                </tr>
            `).join("")
            : `<tr><td colspan="10" class="empty-history">No trades in this window</td></tr>`;
    }

    if (elements.backtestBinaryBody) {
        elements.backtestBinaryBody.innerHTML = result.binaryStats.length
            ? result.binaryStats.map(row => `
                <tr>
                    <td>${row.label}</td>
                    <td>${expiryLabel(row.expiryLength, interval)}</td>
                    <td>${row.trades}</td>
                    <td>${row.reliable
                        ? `${formatNumber(row.winRate, 1)}%`
                        : `<span class="empty-history">not enough data (${row.trades}/20)</span>`}</td>
                    <td>${formatNumber(row.breakevenWinRate, 1)}%</td>
                    <td>${row.reliable ? `<span class="${edgeClass(row.edge)}">${formatSigned(row.edge)}%</span>` : "--"}</td>
                    <td><span class="badge ${verdictClass(row.verdict)}">${row.verdict}</span></td>
                </tr>
            `).join("")
            : `<tr><td colspan="7" class="empty-history">No resolved binary bets in this window</td></tr>`;
    }
}

// Renders the walk-forward result set: one column per fold plus a
// "Folds +" consistency count, so a strategy whose aggregate PnL is
// really just one outlier fold is visible at a glance rather than
// buried inside a single summed number.
export function renderWalkForwardResults(elements, result) {
    const { folds } = result;

    if (elements.backtestWalkForwardRanges) {
        elements.backtestWalkForwardRanges.textContent = folds
            .map((f) => `Fold ${f.fold}: ${new Date(f.from).toLocaleDateString()} → ${new Date(f.to).toLocaleDateString()} (${f.candleCount.toLocaleString()} candles)`)
            .join("  ·  ");
    }

    if (elements.backtestWalkForwardHead) {
        elements.backtestWalkForwardHead.innerHTML = `
            <tr>
                <th>Strategy</th>
                ${folds.map((f) => `<th>Fold ${f.fold} PnL</th>`).join("")}
                <th>Folds +</th>
                <th>Avg PnL / Fold</th>
            </tr>
        `;
    }

    if (elements.backtestWalkForwardBody) {
        // Collect every strategy id that appears in at least one fold's
        // leaderboard, then build one row per strategy across all folds.
        const strategyIds = new Set();
        folds.forEach((f) => f.spotLeaderboard.forEach((row) => strategyIds.add(row.strategy)));

        if (!strategyIds.size) {
            elements.backtestWalkForwardBody.innerHTML =
                `<tr><td colspan="${folds.length + 3}" class="empty-history">No trades across any fold in this window</td></tr>`;
        } else {
            const rows = Array.from(strategyIds).map((strategyId) => {
                const perFold = folds.map((f) => f.spotLeaderboard.find((row) => row.strategy === strategyId) ?? null);
                const label = perFold.find((row) => row)?.label ?? strategyId;
                const pnls = perFold.map((row) => row?.totalPnl ?? 0);
                const positiveFolds = perFold.filter((row) => row && row.trades > 0 && row.totalPnl > 0).length;
                const foldsWithTrades = perFold.filter((row) => row && row.trades > 0).length;
                const avgPnl = foldsWithTrades ? pnls.reduce((a, b) => a + b, 0) / foldsWithTrades : 0;

                return { label, perFold, positiveFolds, foldsWithTrades, avgPnl };
            }).sort((a, b) => b.avgPnl - a.avgPnl);

            elements.backtestWalkForwardBody.innerHTML = rows.map((row) => `
                <tr>
                    <td>${row.label}</td>
                    ${row.perFold.map((f) => f && f.trades > 0
                        ? `<td data-pnl="${pnlDirection(f.totalPnl)}">${formatSigned(f.totalPnl)}% <span class="subtle">(${f.trades}t)</span></td>`
                        : `<td class="empty-history">--</td>`
                    ).join("")}
                    <td>${row.positiveFolds}/${row.foldsWithTrades || folds.length}</td>
                    <td data-pnl="${pnlDirection(row.avgPnl)}">${formatSigned(row.avgPnl)}%</td>
                </tr>
            `).join("");
        }
    }
}
