import {
    computeStrategyStats
} from "@analysis/performanceStats.js";

function finite(values) {
    return values.filter((value) => Number.isFinite(value));
}

function average(values) {
    const valid = finite(values);
    if (!valid.length) return null;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function median(values) {
    const valid = finite(values).slice().sort((a, b) => a - b);
    if (!valid.length) return null;
    const m = Math.floor(valid.length / 2);
    return valid.length % 2 === 0 ? (valid[m - 1] + valid[m]) / 2 : valid[m];
}

function groupBy(trades, keyFn) {
    const groups = new Map();
    for (const trade of trades) {
        const key = keyFn(trade);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(trade);
    }
    return groups;
}

function stats(trades) {
    if (!trades.length) {
        return { trades: 0, expectancy: null, profitFactor: null, winRate: null, totalPnl: 0 };
    }
    const result = computeStrategyStats(trades);
    return {
        trades: result.trades,
        expectancy: result.expectancy,
        profitFactor: result.profitFactor,
        winRate: result.winRate != null ? result.winRate * 100 : null,
        totalPnl: result.totalReturn,
        avgWin: result.avgWin,
        avgLoss: result.avgLoss,
        sharpe: result.sharpe,
        sortino: result.sortino,
        maxDrawdown: result.maxDrawdown
    };
}

function grossStats(trades) {
    return stats(
        trades
            .filter((trade) => Number.isFinite(Number(trade.grossPnlPercent)))
            .map((trade) => ({ ...trade, pnlPercent: Number(trade.grossPnlPercent) }))
    );
}

function netStats(trades) {
    return stats(trades.map((trade) => ({ ...trade, pnlPercent: Number(trade.pnlPercent) })));
}

function edgeDecomposition(gross, net, costs) {
    const grossExpectancy = Number(gross?.expectancy);
    const netExpectancy = Number(net?.expectancy);
    const costDrag = Number(costs?.averageCostDrag);

    return {
        grossExpectancy: Number.isFinite(grossExpectancy) ? grossExpectancy : null,
        netExpectancy: Number.isFinite(netExpectancy) ? netExpectancy : null,
        averageCostDrag: Number.isFinite(costDrag) ? costDrag : null,
        grossPositive: Number.isFinite(grossExpectancy) && grossExpectancy > 0,
        netPositive: Number.isFinite(netExpectancy) && netExpectancy > 0,
        costsDestroyedEdge:
            Number.isFinite(grossExpectancy) &&
            Number.isFinite(netExpectancy) &&
            grossExpectancy > 0 &&
            netExpectancy < 0,
        costDragToGrossRatio:
            Number.isFinite(grossExpectancy) &&
            grossExpectancy > 0 &&
            Number.isFinite(costDrag)
                ? Math.abs(costDrag) / Math.abs(grossExpectancy)
                : null
    };
}

function directionDiagnostics(trades) {
    const groups = groupBy(trades, (trade) => String(trade.side ?? trade.direction ?? "unknown").toLowerCase());
    const result = {};
    for (const [direction, group] of groups) {
        const gross = grossStats(group);
        const net = netStats(group);
        result[direction] = {
            trades: group.length,
            grossExpectancy: gross.expectancy,
            netExpectancy: net.expectancy,
            grossWinRate: gross.winRate,
            netWinRate: net.winRate,
            grossProfitFactor: gross.profitFactor,
            netProfitFactor: net.profitFactor,
            totalGrossPnl: gross.totalPnl,
            totalNetPnl: net.totalPnl
        };
    }
    return result;
}

function excursionEfficiency(excursions) {
    const mfe = Number(excursions?.averageMFE);
    const mae = Math.abs(Number(excursions?.averageMAE));
    if (!Number.isFinite(mfe) || !Number.isFinite(mae) || mae === 0) {
        return null;
    }
    return {
        averageMFE: mfe,
        averageMAE: mae,
        mfeMaeRatio: mfe / mae,
        interpretation: mfe > mae ? "favourable_excursion_dominates" : "adverse_excursion_dominates"
    };
}

function costDiagnostics(trades) {
    const costs = trades.map((trade) => Number(trade.costDragPercent)).filter(Number.isFinite);
    const gross = trades.map((trade) => Number(trade.grossPnlPercent)).filter(Number.isFinite);
    const net = trades.map((trade) => Number(trade.pnlPercent)).filter(Number.isFinite);
    return {
        tradesWithCostData: costs.length,
        averageCostDrag: average(costs),
        medianCostDrag: median(costs),
        totalCostDrag: costs.length ? costs.reduce((sum, v) => sum + v, 0) : null,
        grossExpectancy: average(gross),
        netExpectancy: average(net)
    };
}

function excursionDiagnostics(trades) {
    const mae = trades.map((t) => Number(t.maePercent)).filter(Number.isFinite);
    const mfe = trades.map((t) => Number(t.mfePercent)).filter(Number.isFinite);
    const winners = trades.filter((t) => Number(t.pnlPercent) > 0);
    const losers = trades.filter((t) => Number(t.pnlPercent) < 0);
    return {
        tradesWithExcursionData: Math.min(mae.length, mfe.length),
        averageMAE: average(mae),
        medianMAE: median(mae),
        averageMFE: average(mfe),
        medianMFE: median(mfe),
        winningMAE: average(winners.map((t) => Number(t.maePercent))),
        winningMFE: average(winners.map((t) => Number(t.mfePercent))),
        losingMAE: average(losers.map((t) => Number(t.maePercent))),
        losingMFE: average(losers.map((t) => Number(t.mfePercent)))
    };
}

function exitDiagnostics(trades) {
    const groups = groupBy(trades, (trade) => trade.closeReason ?? "unknown");
    return Object.fromEntries(
        [...groups.entries()].map(([reason, group]) => [
            reason,
            {
                ...stats(group),
                averageHoldingCandles: average(group.map((trade) => Number(trade.holdingCandles))),
                averageMFE: average(group.map((trade) => Number(trade.mfePercent))),
                averageMAE: average(group.map((trade) => Number(trade.maePercent)))
            }
        ])
    );
}

function exitReasonSummary(trades) {
    const counts = {};
    for (const trade of trades) {
        const reason = trade.closeReason ?? "unknown";
        counts[reason] = (counts[reason] ?? 0) + 1;
    }
    const total = trades.length;
    return Object.fromEntries(Object.entries(counts).map(([reason, count]) => [reason, { trades: count, percentage: total > 0 ? (count / total) * 100 : 0 }]));
}

function outcomeDiagnostics(trades) {
    const winners = trades.filter((trade) => Number(trade.pnlPercent) > 0);
    const losers = trades.filter((trade) => Number(trade.pnlPercent) < 0);
    const flat = trades.filter((trade) => Number(trade.pnlPercent) === 0);

    const stopLoss = trades.filter((trade) => ["stop_loss", "STOP_LOSS", "stopLoss"].includes(trade.closeReason));
    const takeProfit = trades.filter((trade) => ["take_profit", "TAKE_PROFIT", "takeProfit"].includes(trade.closeReason));
    const timeout = trades.filter((trade) => ["timeout", "TIMEOUT", "expired", "end_of_data"].includes(trade.closeReason));

    const total = trades.length;
    const percentage = (count) => (total > 0 ? (count / total) * 100 : 0);

    return {
        total,
        winners: winners.length,
        losers: losers.length,
        flat: flat.length,
        winnerPct: percentage(winners.length),
        loserPct: percentage(losers.length),
        stopLossCount: stopLoss.length,
        takeProfitCount: takeProfit.length,
        timeoutCount: timeout.length,
        stopLossPct: percentage(stopLoss.length),
        takeProfitPct: percentage(takeProfit.length),
        timeoutPct: percentage(timeout.length)
    };
}

function holdingDiagnostics(trades) {
    const values = trades.map((trade) => Number(trade.holdingCandles)).filter(Number.isFinite);
    const winning = trades.filter((t) => Number(t.pnlPercent) > 0).map((t) => Number(t.holdingCandles));
    const losing = trades.filter((t) => Number(t.pnlPercent) < 0).map((t) => Number(t.holdingCandles));
    return {
        averageCandles: average(values),
        medianCandles: median(values),
        averageWinningCandles: average(winning),
        medianWinningCandles: median(winning),
        averageLosingCandles: average(losing),
        medianLosingCandles: median(losing)
    };
}

function groupedDiagnostics(trades, keyFn) {
    const groups = groupBy(trades, keyFn);
    return Object.fromEntries([...groups.entries()].map(([key, group]) => [key, stats(group)]));
}

function confidenceDiagnostics(trades) {
    const bands = [
        { label: "50-59", min: 50, max: 60 },
        { label: "60-69", min: 60, max: 70 },
        { label: "70-79", min: 70, max: 80 },
        { label: "80-89", min: 80, max: 90 },
        { label: "90-100", min: 90, max: 101 }
    ];
    const rows = {};
    for (const band of bands) {
        const group = trades.filter((trade) => {
            const confidence = Number(trade.confidence);
            return Number.isFinite(confidence) && confidence >= band.min && confidence < band.max;
        });
        rows[band.label] = stats(group);
    }
    return rows;
}



function classifyDiagnosis({
    grossExpectancy,
    netExpectancy,
    averageCostDrag,
    outcomes,
    excursions,
    regime,
    confidence
}) {
    /*
     * ------------------------------------------------------------
     * 1. INSUFFICIENT DATA
     * ------------------------------------------------------------
     */
    if (!Number.isFinite(grossExpectancy) && !Number.isFinite(netExpectancy)) {
        return {
            category: "INSUFFICIENT_DATA",
            recommendation: "There is not enough valid trade data to diagnose this strategy."
        };
    }

    /*
     * ------------------------------------------------------------
     * 2. COST FAILURE
     * ------------------------------------------------------------
     */
    if (
        Number.isFinite(grossExpectancy) &&
        Number.isFinite(netExpectancy) &&
        grossExpectancy > 0 &&
        netExpectancy < 0 &&
        Number.isFinite(averageCostDrag)
    ) {
        return {
            category: "COST_FAILURE",
            recommendation:
                "The strategy has positive gross expectancy, but execution costs eliminate the edge. Investigate trade frequency, spread/slippage assumptions, entry selectivity and profit-target size before changing the signal."
        };
    }

    /*
     * ------------------------------------------------------------
     * 3. SIGNAL FAILURE
     * ------------------------------------------------------------
     */
    if (Number.isFinite(grossExpectancy) && grossExpectancy < 0) {
        /*
         * However, if MFE is meaningfully positive while the
         * realised result is negative, the signal may contain
         * directional information that the exit model is failing
         * to capture.
         */
        if (
            Number.isFinite(excursions?.averageMFE) &&
            excursions.averageMFE > 0 &&
            Number.isFinite(excursions?.averageMAE) &&
            Math.abs(excursions.averageMAE) > excursions.averageMFE
        ) {
            return {
                category: "SIGNAL_AND_EXIT_FAILURE",
                recommendation:
                    "Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry."
            };
        }

        return {
            category: "SIGNAL_FAILURE",
            recommendation:
                "The strategy has negative gross expectancy. Do not optimise execution costs yet; investigate the entry/exit logic first."
        };
    }

    /*
     * ------------------------------------------------------------
     * REGIME / CONFIDENCE SENSITIVITY (keep existing thresholds)
     * ------------------------------------------------------------
     */
    const regimeValues = Object.values(regime ?? {}).map((row) => row.expectancy).filter(Number.isFinite);
    if (regimeValues.length >= 2 && Math.max(...regimeValues) - Math.min(...regimeValues) > 0.25) {
        return {
            category: "REGIME_DEPENDENT",
            recommendation: "Performance varies materially by market regime. Test regime filtering before changing the core signal."
        };
    }

    const confidenceValues = Object.values(confidence ?? {}).map((row) => row.expectancy).filter(Number.isFinite);
    if (confidenceValues.length >= 2 && Math.max(...confidenceValues) - Math.min(...confidenceValues) > 0.2) {
        return {
            category: "CONFIDENCE_SENSITIVE",
            recommendation: "Performance varies across confidence bands. Test whether confidence contains useful ranking information before changing the signal."
        };
    }

    /*
     * ------------------------------------------------------------
     * EXIT MODEL FAILURE
     * ------------------------------------------------------------
     */
    if (Number.isFinite(grossExpectancy) && grossExpectancy < 0 && Number.isFinite(excursions?.averageMFE) && excursions.averageMFE > 0) {
        return {
            category: "EXIT_MODEL_FAILURE",
            recommendation:
                "Trades show favourable excursion despite negative realised expectancy. Investigate stop distance, take-profit distance and maximum holding period before changing the signal."
        };
    }

    /*
     * STOP-LOSS / HOLDING checks
     */
    if (Number.isFinite(outcomes?.stopLossPct) && outcomes.stopLossPct >= 70) {
        return {
            category: "STOP_LOSS_DOMINATED",
            recommendation:
                "Most trades are ending at the stop-loss. Investigate stop placement, entry timing and whether the strategy is entering during normal adverse volatility."
        };
    }

    if (Number.isFinite(outcomes?.timeoutPct) && outcomes.timeoutPct >= 50) {
        return {
            category: "HOLDING_PERIOD_FAILURE",
            recommendation: "A large proportion of trades expire without reaching the intended exit. Test holding-period sensitivity before changing the signal."
        };
    }

    return {
        category: "MIXED",
        recommendation: "No single dominant failure mode was detected. Investigate exits, MAE/MFE and market/timeframe breakdowns."
    };
}

export function buildStrategyDiagnostics(
    trades,
    {
        strategy = null
    } = {}
) {
    const selected =
        strategy
            ? trades.filter(
                (trade) =>
                    trade.strategy ===
                    strategy
            )
            : trades;

    if (!selected.length) {
        return {
            strategy,
            sampleSize: 0
        };
    }

    const gross =
        grossStats(selected);

    const net =
        netStats(selected);

    const costs =
        costDiagnostics(selected);

    const excursions =
        excursionDiagnostics(
            selected
        );

    const exits =
        exitDiagnostics(
            selected
        );

    const holding =
        holdingDiagnostics(
            selected
        );

    const outcomes =
        outcomeDiagnostics(
            selected
        );
    const exitReasons =
        exitReasonSummary(
            selected
        );

    const direction = directionDiagnostics(selected);

    const edge = edgeDecomposition(gross, net, costs);

    const excursionEff = excursionEfficiency(excursions);

    const market =
        groupedDiagnostics(
            selected,
            (trade) =>
                trade.symbol ??
                "UNKNOWN"
        );

    const timeframe =
        groupedDiagnostics(
            selected,
            (trade) =>
                trade.timeframe ??
                "UNKNOWN"
        );

    const regime =
        groupedDiagnostics(
            selected,
            (trade) =>
                trade.regime ??
                "UNKNOWN"
        );

    const confidence =
        confidenceDiagnostics(
            selected
        );

    const diagnosis =
        classifyDiagnosis({
            grossExpectancy:
                gross.expectancy,

            netExpectancy:
                net.expectancy,

            averageCostDrag:
                costs.averageCostDrag,

            regime,

            confidence,

            outcomes,

            excursions
        });

    return {
        strategy,

        label:
            selected.find(
                (trade) =>
                    trade.label
            )?.label ??
            strategy,

        sampleSize:
            selected.length,

        gross,
        net,
        costs,
        excursions,
        exits,
        outcomes,
        exitReasons,
        holding,
        direction,
        edge,
        excursionEfficiency: excursionEff,
        market,
        timeframe,
        regime,
        confidence,

        diagnosis
    };
}

export function buildAllStrategyDiagnostics(
    trades
) {
    const strategies =
        [
            ...new Set(
                trades
                    .map(
                        (trade) =>
                            trade.strategy
                    )
                    .filter(Boolean)
            )
        ];

    return strategies
        .map(
            (strategy) =>
                buildStrategyDiagnostics(
                    trades,
                    { strategy }
                )
        )
        .sort(
            (a, b) => {
                const bexp = (b.net && b.net.expectancy) || -Infinity;
                const aexp = (a.net && a.net.expectancy) || -Infinity;
                return bexp - aexp;
            }
        );
}

export function buildDiagnosticSummary(
    diagnostics
) {
    const summary = {
        totalStrategies: diagnostics.length,
        signalFailure: 0,
        costFailure: 0,
        exitModelFailure: 0,
        holdingPeriodFailure: 0,
        positiveNetEdge: 0,
        insufficientData: 0,
        mixed: 0
    };

    for (const row of diagnostics) {
        switch (row.diagnosis?.category) {
            case "SIGNAL_FAILURE":
                summary.signalFailure++;
                break;
            case "SIGNAL_AND_EXIT_FAILURE":
                summary.signalFailure++;
                summary.exitModelFailure++;
                break;
            case "COST_FAILURE":
                summary.costFailure++;
                break;
            case "EXIT_MODEL_FAILURE":
                summary.exitModelFailure++;
                break;
            case "HOLDING_PERIOD_FAILURE":
                summary.holdingPeriodFailure++;
                break;
            case "POSITIVE_NET_EDGE":
                summary.positiveNetEdge++;
                break;
            case "INSUFFICIENT_DATA":
                summary.insufficientData++;
                break;
            default:
                summary.mixed++;
        }
    }

    return summary;
}
