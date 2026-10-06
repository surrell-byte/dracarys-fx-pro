// R-multiple metrics put trades onto a common risk basis.
// +1R equals the original stop risk; -1R equals one stop loss.

function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}

export function tradeRiskPercent(trade) {
    const entry = number(trade?.entry);
    const stop = number(trade?.stopLoss);

    if (entry == null || stop == null || entry === 0) {
        return null;
    }

    return Math.abs(entry - stop) / Math.abs(entry) * 100;
}

export function tradeRMultiple(trade, pnlField = "pnlPercent") {
    const riskPercent = number(trade?.riskPercent) ?? tradeRiskPercent(trade);
    const pnlPercent = number(trade?.[pnlField]);

    if (riskPercent == null || riskPercent <= 0 || pnlPercent == null) {
        return null;
    }

    return pnlPercent / riskPercent;
}

function summarize(values) {
    const valid = values.filter(value => Number.isFinite(value));

    if (!valid.length) {
        return {
            tradesWithR: 0,
            expectancyR: null,
            profitFactorR: null,
            totalR: 0,
            avgWinR: null,
            avgLossR: null,
            maxDrawdownR: 0
        };
    }

    const wins = valid.filter(value => value > 0);
    const losses = valid.filter(value => value < 0);
    const grossProfit = wins.reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
    const expectancyR = valid.reduce((sum, value) => sum + value, 0) / valid.length;

    let running = 0;
    let peak = 0;
    let maxDrawdownR = 0;

    for (const value of valid) {
        running += value;
        peak = Math.max(peak, running);
        maxDrawdownR = Math.max(maxDrawdownR, peak - running);
    }

    return {
        tradesWithR: valid.length,
        expectancyR,
        profitFactorR: grossLoss > 0 ? grossProfit / grossLoss : null,
        totalR: running,
        avgWinR: wins.length ? grossProfit / wins.length : 0,
        avgLossR: losses.length ? grossLoss / losses.length : 0,
        maxDrawdownR
    };
}

export function computeRStats(trades) {
    const netR = trades.map(trade => tradeRMultiple(trade, "pnlPercent"));
    const grossR = trades.map(trade => tradeRMultiple(trade, "grossPnlPercent"));
    const net = summarize(netR);
    const gross = summarize(grossR);

    return {
        ...net,
        grossExpectancyR: gross.expectancyR,
        grossProfitFactorR: gross.profitFactorR,
        totalGrossR: gross.totalR,
        avgGrossWinR: gross.avgWinR,
        avgGrossLossR: gross.avgLossR
    };
}
