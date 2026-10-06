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
