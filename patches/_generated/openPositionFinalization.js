// A position opened before the final candle gets marked out at the final
// available close if SL/TP/timeout didn't already close it. A position
// opened ON the final candle is not fabricated into a same-candle trade —
// it's counted as censored instead.
let openPositionsMarkedToClose = 0;
let openPositionsDropped = 0;

for (const id of strategyIds) {
    const position = spotPositions[id];
    if (!position.side) continue;

    if (!Number.isInteger(position.openedIndex) || position.openedIndex >= total - 1) {
        openPositionsDropped += 1;
        position.side = null;
        position.type = null;
        position.entryPrice = null;
        position.stopLoss = null;
        position.takeProfit = null;
        position.candlesSinceOpen = 0;
        position.confidence = null;
        position.regime = null;
        position.openedAt = null;
        position.openedIndex = null;
        continue;
    }

    const finalCandle = candles.at(-1);

    const finalExit = evaluateCandleExit({
        position: {
            type: position.type,
            entryPrice: position.entryPrice,
            stopLoss: position.stopLoss,
            takeProfit: position.takeProfit
        },
        candle: finalCandle,
        candlesSinceOpen: position.candlesSinceOpen + 1,
        maxHoldCandles,
        ambiguousFillRule,
        assetClass,
        costs
    });

    const exit = finalExit ?? (() => {
        const rawExit = Number(finalCandle.close);
        const exitPrice = applyExitCost(rawExit, position.type, assetClass, costs);
        const rawPnlPct =
            position.type === "BUY"
                ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
                : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
        const pnlPct = applyFeeToPnl(rawPnlPct, assetClass, costs);

        return {
            exitPrice,
            pnlPct,
            outcome: pnlPct >= 0 ? "win" : "loss",
            closeReason: "end_of_data"
        };
    })();

    spotTrades.push({
        strategy: id,
        label: STRATEGIES[id]?.label ?? id,
        side: position.side,
        entry: position.entryPrice,
        exit: exit.exitPrice,
        pnlPercent: exit.pnlPct,
        openedAt: position.openedAt,
        closedAt: finalCandle.time,
        confidence: position.confidence ?? null,
        outcome: exit.outcome,
        closeReason: exit.closeReason,
        regime: position.regime ?? null
    });

    openPositionsMarkedToClose += 1;

    position.side = null;
    position.type = null;
    position.entryPrice = null;
    position.stopLoss = null;
    position.takeProfit = null;
    position.candlesSinceOpen = 0;
    position.confidence = null;
    position.regime = null;
    position.openedAt = null;
    position.openedIndex = null;
}
