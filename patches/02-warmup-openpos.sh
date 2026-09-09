#!/usr/bin/env bash
# 02-warmup-openpos.sh
# Rewrites runWalkForwardBacktest() to give fold 1 real warm-up context,
# and adds end-of-data handling for still-open positions.
#
# NOTE: this script prints the new runWalkForwardBacktest() body and the
# open-position block to files for you to paste in, because the exact
# original function bodies vary enough (spotPositions init, main loop
# shape) that a blind automated replace is riskier than a careful manual
# swap. Run this first, then follow the printed instructions.
set -euo pipefail

FILE="frontend/src/js/analysis/backtestEngine.js"
OUTDIR="patches/_generated"
mkdir -p "$OUTDIR"

if [ ! -f "$FILE" ]; then
  echo "❌ $FILE not found. Run this from the project root." >&2
  exit 1
fi

cat > "$OUTDIR/runWalkForwardBacktest.js" <<'EOF'
export async function runWalkForwardBacktest(candles, options = {}) {
    const {
        folds = 4,
        dailyCandles = null,
        warmupCandles = DEFAULT_MAX_WINDOW,
        // Historical candles supplied but NOT part of the scored sample.
        // The research runner should fetch initialContextCandles + scoringCandles
        // so fold 1 also gets a full warm-up window.
        initialContextCandles = 0,
        ...rest
    } = options;

    if (!Array.isArray(candles) || candles.length < 2) {
        throw new Error("Not enough candles for walk-forward backtest.");
    }
    if (!Number.isInteger(folds) || folds < 2) {
        throw new Error("folds must be an integer >= 2.");
    }
    if (!Number.isInteger(warmupCandles) || warmupCandles < 0) {
        throw new Error("warmupCandles must be an integer >= 0.");
    }
    if (!Number.isInteger(initialContextCandles) || initialContextCandles < 0) {
        throw new Error("initialContextCandles must be an integer >= 0.");
    }
    if (initialContextCandles >= candles.length) {
        throw new Error("initialContextCandles must be smaller than candle count.");
    }

    const scoringStart = initialContextCandles;
    const scoringCandles = candles.slice(scoringStart);

    if (scoringCandles.length < folds * 2) {
        throw new Error(
            `Not enough scoring candles for ${folds} folds. ` +
            `Need at least ${folds * 2}, got ${scoringCandles.length}.`
        );
    }

    const foldSize = Math.floor(scoringCandles.length / folds);
    const results = [];

    for (let f = 0; f < folds; f += 1) {
        const relativeFoldStart = f * foldSize;
        const relativeFoldEnd =
            f === folds - 1 ? scoringCandles.length : relativeFoldStart + foldSize;

        const foldStart = scoringStart + relativeFoldStart;
        const foldEnd = scoringStart + relativeFoldEnd;

        // Every fold gets as much historical context as available —
        // for fold 1 that's initialContextCandles, for later folds it's
        // the preceding candles in the full series.
        const contextStart = Math.max(0, foldStart - warmupCandles);
        const foldCandles = candles.slice(contextStart, foldEnd);
        const scoreStartIndex = foldStart - contextStart;

        // HTF isolation: only daily candles that existed before this
        // fold's first scored candle are supplied.
        const foldStartTime = candles[foldStart]?.time;
        const foldDailyCandles =
            Array.isArray(dailyCandles) && Number.isFinite(foldStartTime)
                ? dailyCandles.filter(
                      (d) => Number.isFinite(d?.time) && d.time <= foldStartTime
                  )
                : null;

        const result = await runBacktest(foldCandles, {
            ...rest,
            dailyCandles: foldDailyCandles,
            scoreStartIndex
        });

        results.push({
            fold: f + 1,
            from: foldCandles[scoreStartIndex]?.time ?? foldCandles[0]?.time,
            to: foldCandles.at(-1)?.time ?? null,
            candleCount: foldEnd - foldStart,
            contextCandles: scoreStartIndex,
            scoreStartIndex,
            foldStartIndex: foldStart,
            foldEndIndex: foldEnd,
            initialContextCandles,
            warmupRequested: warmupCandles,
            fullWarmupAvailable: scoreStartIndex >= warmupCandles,
            higherTimeframeCandles: foldDailyCandles ? foldDailyCandles.length : 0,
            higherTimeframeApplied:
                Array.isArray(foldDailyCandles) && foldDailyCandles.length >= 200,
            ...result
        });
    }

    return {
        folds: results,
        summary: {
            // Deliberately NOT called true parameter-optimised walk-forward —
            // there's no train -> optimise -> lock -> unseen-test stage yet.
            method: "rolling-origin-out-of-sample-evaluation",
            optimizationPerformed: false,
            foldCount: folds,
            totalInputCandles: candles.length,
            initialContextCandles,
            totalScoredCandles: scoringCandles.length,
            warmupCandles,
            allFoldsHaveFullWarmup: results.every((fold) => fold.fullWarmupAvailable),
            allFoldsHaveHTFContext: results.every(
                (fold) => !fold.higherTimeframeCandles || fold.higherTimeframeCandles >= 200
            ),
            note:
                "Each fold is an independent chronological out-of-sample " +
                "evaluation. Parameters are not optimised inside this run."
        }
    };
}
EOF

cat > "$OUTDIR/openPositionFinalization.js" <<'EOF'
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
EOF

echo "Generated:"
echo "  $OUTDIR/runWalkForwardBacktest.js"
echo "  $OUTDIR/openPositionFinalization.js"
echo ""
echo "Now, in $FILE, by hand:"
echo "  1. Replace the ENTIRE existing 'export async function runWalkForwardBacktest(...) { ... }'"
echo "     with the contents of $OUTDIR/runWalkForwardBacktest.js"
echo "  2. In each strategy position-init object inside runBacktest(), add: openedIndex: null,"
echo "  3. Where a position is opened, add: position.openedIndex = i;"
echo "  4. Where a position closes normally, add: position.openedIndex = null;"
echo "  5. Immediately AFTER the main 'for (let i = 0; i < total; i++) { ... }' loop and"
echo "     BEFORE 'onProgress?.(total, total);', paste in the contents of"
echo "     $OUTDIR/openPositionFinalization.js"
echo "  6. Add 'openPositionsMarkedToClose,' and 'openPositionsDropped,' to the returned meta object."
echo ""
echo "(This step is manual by design — the surrounding code varies too much to patch blindly.)"
