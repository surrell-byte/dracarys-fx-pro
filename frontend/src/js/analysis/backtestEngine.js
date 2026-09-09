import { generateSignal, STRATEGIES } from "@signals/signalEngine.js";
import { evaluateEdge } from "@analysis/payoutMetrics.js";
import { DEFAULT_EXPIRY_LENGTHS } from "@analysis/binaryTracker.js";
import { calculateEMA } from "@indicators/indicators.js";
import {
    applyExitCost,
    applyFeeToPnl,
    DEFAULT_EXECUTION_COSTS
} from "@analysis/executionCosts.js";
import { createEntryFill, evaluateCandleExit } from "@analysis/executionSimulator.js";
import { computeStrategyStats } from "@analysis/performanceStats.js";
import { passesEntryFilters } from "@risk/entryFilters.js";

/*
 * Per-strategy cost profile override.
 *
 * The default cost model (executionCosts.js) resolves purely off
 * assetClass — every strategy trading BTC/USDT pays the same taker fee.
 * That's realistic for strategies that need immediate fills, but it
 * silently mischarges strategies whose entries/exits could reasonably
 * be posted as resting limit orders (maker), which is a meaningfully
 * cheaper way to trade the same signal.
 *
 * strategy.costProfile === "maker" opts a strategy into the cheaper
 * cryptoMaker profile for crypto markets only; forex is untouched since
 * DEFAULT_EXECUTION_COSTS has no forex maker tier (spreads there are
 * already far smaller than the taker fee crypto pays). This resolver is
 * the single place that decision is made, so backtests and any future
 * live paper-trading integration can't drift apart on it.
 */
function resolveCostsForStrategy(id, assetClass, costs) {
    // An explicit costs override always wins - we never second-guess a
    // caller who passed a concrete cost object.
    if (costs) return costs;
    if (assetClass !== "crypto") return costs;

    const profile = STRATEGIES[id]?.costProfile;
    if (profile === "maker") return DEFAULT_EXECUTION_COSTS.cryptoMaker;
    return costs;
}

/*
 * BACKTEST EXECUTION MODEL
 *
 * The spot model is a risk-managed position model.
 *
 * BUY:
 *   flat -> LONG
 *
 * SELL:
 *   flat -> SHORT
 *
 * Once a position is open, it remains open until:
 *
 *   1. stop-loss
 *   2. take-profit
 *   3. maximum holding period
 *
 * An opposite signal does NOT automatically reverse the position.
 *
 * This deliberately differs from StrategyTester, which is a
 * signal-reversal model. StrategyTester should therefore not be
 * described as an exact execution-parity implementation of this
 * backtest.
 *
 * The backtest execution lifecycle is:
 *
 *   existing position
 *       ↓
 *   check SL / TP / timeout
 *       ↓
 *   generate signal
 *       ↓
 *   open position only if flat
 */

// Backtests historical candles walk-forward through the SAME generateSignal
// pipeline the live app uses - this is deliberately not a reimplementation
// of the scoring logic, it's a replay of it. Every step only ever sees
// candles up to and including that step (no lookahead), and the sliding
// window is capped at `maxWindow` candles to match how the live app trims
// state.candles - a backtest that fed the engine an ever-growing history
// would score signals on more context than the live app ever actually has,
// which would make the numbers here optimistic in a way that doesn't
// transfer to live trading.
//
// Two outcome models run side by side per strategy, per candle:
//   - "spot": a risk-managed running position that remains open until
//     SL / TP / timeout. Opposite signals do not reverse an open trade.
//   - "binary": a fixed-expiry directional bet, win if price closed on the
//     predicted side N candles later (mirrors BinaryOutcomeTracker), scored
//     against the broker payout via the same evaluateEdge() breakeven math.
// Neither model writes to localStorage - this is a pure, disposable replay,
// so it can never corrupt the live tester's persisted state.
export const DEFAULT_MAX_WINDOW = 320; // matches app.js state.maxCandles

// Builds a lookup that, given any intraday timestamp, returns the
// higher-timeframe (daily) trend that would have been known *as of that
// time* - i.e. only using daily candles that had already closed. This is
// what closes the "backtest doesn't reproduce HTF-gated strategies" gap:
// strategies with useHigherTimeframe were previously backtested with the
// filter permanently disabled (context always defaulted to NEUTRAL),
// which is a different, generally looser, trading rule than what actually
// runs live. No lookahead: a daily candle only starts influencing the
// trend once it has fully closed (its own `time` plus one day has passed).
function buildHigherTimeframeLookup(dailyCandles) {
    if (!Array.isArray(dailyCandles) || dailyCandles.length < 200) {
        return () => "NEUTRAL";
    }

    // Daily candle timestamps represent the candle OPEN. We can't assume
    // every daily candle spans exactly 86,400,000ms (FX daily candles shift
    // with timezone/DST/broker session boundaries), so a daily candle only
    // becomes usable once the NEXT daily candle has opened.
    const sorted = dailyCandles
        .filter((c) => Number.isFinite(c?.time) && Number.isFinite(c?.close))
        .slice()
        .sort((a, b) => a.time - b.time);

    if (sorted.length < 200) {
        return () => "NEUTRAL";
    }

    const closes = sorted.map((c) => Number(c.close));
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);
    const offset50 = closes.length - ema50.length;
    const offset200 = closes.length - ema200.length;

    const trendByIndex = sorted.map((_, i) => {
        const e50 = ema50[i - offset50];
        const e200 = ema200[i - offset200];
        if (!Number.isFinite(e50) || !Number.isFinite(e200)) return "NEUTRAL";
        if (e50 > e200) return "UP";
        if (e50 < e200) return "DOWN";
        return "NEUTRAL";
    });

    // Candle i counts as "closed" once the NEXT daily open <= timestamp.
    // We intentionally never use the still-forming current daily candle.
    return (timestamp) => {
        if (!Number.isFinite(timestamp)) return "NEUTRAL";

        let lo = 0, hi = sorted.length - 2, result = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const nextDailyOpen = sorted[mid + 1].time;
            if (nextDailyOpen <= timestamp) {
                result = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        return result >= 0 ? trendByIndex[result] : "NEUTRAL";
    };
}

/**
 * Returns the number of DAILY candles that are definitely closed
 * before a given intraday timestamp.
 *
 * IMPORTANT:
 *
 * A daily candle's `time` represents its OPEN timestamp.
 *
 * Therefore:
 *
 *     daily candle A opens at T0
 *     daily candle B opens at T1
 *
 * Candle A is only known to be closed once T1 has arrived.
 *
 * We therefore exclude the currently-forming daily candle.
 *
 * This is intentionally stricter than:
 *
 *     dailyCandles.length >= 200
 *
 * because supplied candles != usable closed candles.
 */
export function countClosedHigherTimeframeCandles(
    dailyCandles,
    timestamp
) {
    if (
        !Array.isArray(dailyCandles) ||
        !Number.isFinite(timestamp)
    ) {
        return 0;
    }
    const sorted =
        dailyCandles
            .filter(
                (candle) =>
                    Number.isFinite(candle?.time)
            )
            .slice()
            .sort(
                (a, b) =>
                    a.time - b.time
            );
    if (sorted.length < 2) {
        return 0;
    }
    /*
     * A candle at index i is closed when the NEXT
     * daily candle has opened.
     *
     * Therefore the maximum usable index is the
     * final candle whose next open <= timestamp.
     */
    let low = 0;
    let high = sorted.length - 2;
    let result = -1;
    while (low <= high) {
        const middle =
            Math.floor(
                (low + high) / 2
            );
        const nextOpen =
            sorted[middle + 1].time;
        if (
            nextOpen <= timestamp
        ) {
            result = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return result >= 0
        ? result + 1
        : 0;
}

function updatePositionExcursion(
    position,
    candle
) {
    if (
        !position?.side ||
        !Number.isFinite(position.entryPrice) ||
        !candle
    ) {
        return;
    }

    const high = Number(candle.high);
    const low = Number(candle.low);

    if (
        !Number.isFinite(high) ||
        !Number.isFinite(low)
    ) {
        return;
    }

    const entry = position.entryPrice;

    if (position.type === "BUY") {
        const favorable =
            ((high - entry) / entry) * 100;

        const adverse =
            ((low - entry) / entry) * 100;

        position.maxFavorablePct =
            Math.max(
                position.maxFavorablePct,
                favorable
            );

        position.maxAdversePct =
            Math.min(
                position.maxAdversePct,
                adverse
            );

        return;
    }

    if (position.type === "SELL") {
        const favorable =
            ((entry - low) / entry) * 100;

        const adverse =
            ((entry - high) / entry) * 100;

        position.maxFavorablePct =
            Math.max(
                position.maxFavorablePct,
                favorable
            );

        position.maxAdversePct =
            Math.min(
                position.maxAdversePct,
                adverse
            );
    }
}

export async function runBacktest(candles, options = {}) {
    const {
        strategyIds = Object.keys(STRATEGIES),
        payoutRatio = 0.85,
        expiryLengths = DEFAULT_EXPIRY_LENGTHS,
        maxWindow = DEFAULT_MAX_WINDOW,
        minSampleSize = 20,
        dailyCandles = null,
        onProgress = null,
        yieldEvery = 40,
        // Execution-cost assumptions (spread/slippage/fee), matching the
        // live scheduler/paper engine (executionCosts.js). Previously the
        // backtest scored trades off raw signal prices with no costs at
        // all, which made backtest results systematically more optimistic
        // than the paper-trading numbers for the exact same strategy -
        // the same signal, "traded" through two different cost models.
        // Passing assetClass/costs here closes that gap; omitting
        // assetClass falls back to the old cost-free behavior so callers
        // that don't care yet aren't silently changed.
        assetClass = null,
        costs = null,
        maxHoldCandles = Infinity,
        ambiguousFillRule = "conservative",
        // Merged into every generateSignal() context alongside higherTrend.
        // Exists so callers (e.g. scripts/analysis/smcAblationTest.js) can
        // pass strategy-scoring options like excludeVoteModules through the
        // backtest loop without backtestEngine needing to know what any
        // particular option means - it's just forwarded verbatim.
        extraSignalContext = {},
        // Candles before this index are indicator/context warmup only.
        // They may be supplied to generateSignal(), but they must not
        // create scored spot or binary trades.
        scoreStartIndex = 0
        ,entryFilters = null
    } = options;

    if (!Array.isArray(candles) || candles.length < 2) {
        throw new Error("Not enough candles to backtest (need at least 2).");
    }

    const getHigherTrend = buildHigherTimeframeLookup(dailyCandles);
    const usesHigherTimeframe = strategyIds.some((id) => STRATEGIES[id]?.useHigherTimeframe);
    if (
        usesHigherTimeframe &&
        (!Array.isArray(dailyCandles) || dailyCandles.length < 200)
    ) {
        console.warn(
            "[backtestEngine] One or more strategies use the higher-timeframe " +
            "filter, but fewer than 200 daily candles are available. " +
            "The HTF filter will remain NEUTRAL until enough historical daily " +
            "data exists."
        );
    }

    const spotPositions = {};
    const spotTrades = [];
    const pendingBinary = [];
    const resolvedBinary = [];
    const lastDirection = {};

    strategyIds.forEach((id) => {
        spotPositions[id] = {
            side: null,
            type: null,

            // Raw market price before execution costs.
            rawEntryPrice: null,

            // Actual simulated filled entry price.
            entryPrice: null,

            stopLoss: null,
            takeProfit: null,

            candlesSinceOpen: 0,

            confidence: null,
            regime: null,

            openedAt: null,
            openedIndex: null,

            // Excursion statistics measured from the actual
            // simulated entry price.
            maxFavorablePct: 0,
            maxAdversePct: 0
        };
        lastDirection[id] = null;
    });

    const total = candles.length;

    for (let i = 0; i < total; i++) {
        const isScoredCandle = i >= scoreStartIndex;

        // 1. Resolve any binary predictions whose expiry has arrived at this index.
        if (isScoredCandle) {
            for (let p = pendingBinary.length - 1; p >= 0; p--) {
                const prediction = pendingBinary[p];
                const targetIndex = prediction.entryIndex + prediction.expiryLength;
                if (targetIndex > i) continue;

                const exitCandle = candles[targetIndex];
                // Binary/fixed-expiry bets settle against the strike (entry)
                // price a broker would actually have quoted, not the bare
                // candle close - apply the same entry/exit fill model as the
                // spot leg so a near-the-money result isn't scored as a win
                // purely because costs were ignored.
                const exitPrice = assetClass
                    ? applyExitCost(exitCandle.close, prediction.direction, assetClass, resolveCostsForStrategy(prediction.strategy, assetClass, costs))
                    : exitCandle.close;
                const win = prediction.direction === "BUY"
                    ? exitPrice > prediction.entryPrice
                    : exitPrice < prediction.entryPrice;

                resolvedBinary.push({
                    strategy: prediction.strategy,
                    expiryLength: prediction.expiryLength,
                    direction: prediction.direction,
                    entryPrice: prediction.entryPrice,
                    exitPrice,
                    win
                });
                pendingBinary.splice(p, 1);
            }
        }

        // 2. Build the same rolling window the live app would have had at this point.
        const windowStart = Math.max(0, i - maxWindow + 1);
        const windowCandles = candles.slice(windowStart, i + 1);
        const candleTime = candles[i].time;

        if (i === scoreStartIndex) {
            strategyIds.forEach((id) => {
                lastDirection[id] = null;
            });
        }

        // 3. One generateSignal() call per strategy per candle, shared by both models.
        strategyIds.forEach((id) => {
            const signal = generateSignal(windowCandles, id, {
                higherTrend: getHigherTrend(candleTime),
                strategyRiskOverrides: extraSignalContext.strategyRiskOverridesByStrategy?.[id],
                ...extraSignalContext
            });
            const position = spotPositions[id];

            if (!isScoredCandle) {
                return;
            }

            /*
             * ============================================================
             * 1. MANAGE EXISTING POSITION FIRST
             * ============================================================
             *
             * A position must continue to be monitored even when the
             * strategy produces WAIT / NEUTRAL / not-ready on this candle.
             */
            if (position.side) {
                position.candlesSinceOpen += 1;

                /*
                 * Update MAE/MFE BEFORE evaluating the exit.
                 *
                 * This ensures the exit candle itself is included in the
                 * excursion analysis.
                 */
                updatePositionExcursion(
                    position,
                    candles[i]
                );

                const exit = evaluateCandleExit({
                    position: {
                        type: position.type,
                        entryPrice: position.entryPrice,
                        rawEntryPrice: position.rawEntryPrice,
                        stopLoss: position.stopLoss,
                        takeProfit: position.takeProfit
                    },
                    candle: candles[i],
                    candlesSinceOpen: position.candlesSinceOpen,
                    maxHoldCandles,
                    ambiguousFillRule,
                    assetClass,
                    costs: resolveCostsForStrategy(id, assetClass, costs)
                });

                if (exit) {
                    spotTrades.push({
                        strategy:
                            id,

                        label:
                            STRATEGIES[id]?.label ?? id,

                        side:
                            position.side,

                        /*
                         * Raw market prices.
                         */
                        rawEntry:
                            position.rawEntryPrice,

                        rawExit:
                            exit.rawExitPrice ?? null,

                        /*
                         * Execution-adjusted prices.
                         */
                        entry:
                            position.entryPrice,

                        exit:
                            exit.exitPrice,

                        /*
                         * Gross performance BEFORE costs.
                         */
                        grossPnlPercent:
                            Number.isFinite(exit.grossPnlPercent)
                                ? exit.grossPnlPercent
                                : null,

                        /*
                         * Net performance AFTER costs.
                         */
                        pnlPercent:
                            exit.pnlPct,

                        costDragPercent:
                            Number.isFinite(exit.costDragPercent)
                                ? exit.costDragPercent
                                : null,

                        /*
                         * MAE / MFE.
                         */
                        maePercent:
                            position.maxAdversePct,

                        mfePercent:
                            position.maxFavorablePct,

                        /*
                         * Timing.
                         */
                        openedAt:
                            position.openedAt,

                        closedAt:
                            candleTime,

                        holdingCandles:
                            position.candlesSinceOpen,

                        holdingMs:
                            Number.isFinite(position.openedAt) &&
                            Number.isFinite(candleTime)
                                ? candleTime - position.openedAt
                                : null,

                        /*
                         * Signal metadata.
                         */
                        confidence:
                            position.confidence ?? null,

                        outcome:
                            exit.outcome,

                        closeReason:
                            exit.closeReason,

                        regime:
                            position.regime ?? null
                    });

                    position.side = null;
                    position.type = null;

                    position.rawEntryPrice = null;
                    position.entryPrice = null;

                    position.stopLoss = null;
                    position.takeProfit = null;

                    position.candlesSinceOpen = 0;

                    position.confidence = null;
                    position.regime = null;

                    position.openedAt = null;
                    position.openedIndex = null;

                    position.maxFavorablePct = 0;
                    position.maxAdversePct = 0;
                }
            }

            /*
             * ============================================================
             * 2. NO NEW ENTRY WITHOUT A VALID SIGNAL
             * ============================================================
             */
            if (!signal.ready) {
                return;
            }

            if (entryFilters?.enabled && !passesEntryFilters(signal, {
                ...entryFilters,
                allowedRegimes: entryFilters.allowedRegimesByStrategy?.[id] ?? entryFilters.allowedRegimes,
                estimatedCostPct: entryFilters.estimatedCostPct ?? 0
            })) {
                return;
            }

            if (signal.type !== "BUY" && signal.type !== "SELL") {
                lastDirection[id] = null;
                return;
            }

            /*
             * ============================================================
             * 3. OPEN NEW POSITION ONLY IF FLAT
             * ============================================================
             */
            if (!position.side) {
                const nextSide = signal.type === "BUY" ? "long" : "short";
                const rawPrice = signal.price ?? windowCandles.at(-1).close;

                position.side = nextSide;
                position.type = signal.type;

                position.rawEntryPrice = rawPrice;

                position.entryPrice =
                    createEntryFill({
                        signal: {
                            type: signal.type,
                            price: rawPrice
                        },
                        assetClass,
                        costs: resolveCostsForStrategy(id, assetClass, costs)
                    });
                position.stopLoss = signal.risk?.stopLoss ?? null;
                position.takeProfit = signal.risk?.takeProfit ?? null;
                position.candlesSinceOpen = 0;
                position.confidence = Number.isFinite(signal.confidence)
                    ? signal.confidence
                    : null;
                position.regime = signal.regime?.primary ?? null;
                position.openedAt = candleTime;
                position.openedIndex = i;

                position.maxFavorablePct = 0;
                position.maxAdversePct = 0;
            }

            /*
             * ============================================================
             * 4. BINARY SIGNAL TRACKING
             * ============================================================
             */
            if (lastDirection[id] !== signal.type) {
                lastDirection[id] = signal.type;
                const binaryEntryPrice = createEntryFill({
                    signal: { type: signal.type, price: signal.price ?? windowCandles.at(-1).close },
                    assetClass,
                    costs: resolveCostsForStrategy(id, assetClass, costs)
                });
                expiryLengths.forEach((expiryLength) => {
                    pendingBinary.push({
                        strategy: id,
                        direction: signal.type,
                        entryPrice: binaryEntryPrice,
                        entryIndex: i,
                        expiryLength
                    });
                });
            }
        });

        if (onProgress && i % yieldEvery === 0) {
            onProgress(i + 1, total);
            // Yield to the event loop periodically so a large backtest never
            // freezes the tab - this is a UI courtesy, not a correctness fix.
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    let openPositionsMarkedToClose = 0;
    let openPositionsDropped = 0;

    for (const id of strategyIds) {
        const position = spotPositions[id];
        if (!position.side) continue;

        if (!Number.isInteger(position.openedIndex) || position.openedIndex >= total - 1) {
            openPositionsDropped += 1;
            position.side = null;
            position.type = null;

            position.rawEntryPrice = null;
            position.entryPrice = null;

            position.stopLoss = null;
            position.takeProfit = null;
            position.candlesSinceOpen = 0;
            position.confidence = null;
            position.regime = null;
            position.openedAt = null;
            position.openedIndex = null;

            position.maxFavorablePct = 0;
            position.maxAdversePct = 0;
            continue;
        }

        const finalCandle = candles.at(-1);

        const finalExit =
            evaluateCandleExit({
                position: {
                    type: position.type,
                    entryPrice: position.entryPrice,
                    rawEntryPrice: position.rawEntryPrice,
                    stopLoss: position.stopLoss,
                    takeProfit: position.takeProfit
                },
                candle: finalCandle,
                candlesSinceOpen:
                    position.candlesSinceOpen + 1,
                maxHoldCandles,
                ambiguousFillRule,
                assetClass,
                costs: resolveCostsForStrategy(id, assetClass, costs)
            });

        updatePositionExcursion(
            position,
            finalCandle
        );

        const exit =
            finalExit ??
            (() => {
                const rawExit =
                    Number(finalCandle.close);

                const exitPrice =
                    applyExitCost(
                        rawExit,
                        position.type,
                        assetClass,
                        resolveCostsForStrategy(id, assetClass, costs)
                    );

                const grossPnlPercent =
                    position.type === "BUY"
                        ? (
                            (rawExit -
                                position.rawEntryPrice) /
                            position.rawEntryPrice
                        ) * 100
                        : (
                            (position.rawEntryPrice -
                                rawExit) /
                            position.rawEntryPrice
                        ) * 100;

                const rawNetPnlPct =
                    position.type === "BUY"
                        ? (
                            (exitPrice -
                                position.entryPrice) /
                            position.entryPrice
                        ) * 100
                        : (
                            (position.entryPrice -
                                exitPrice) /
                            position.entryPrice
                        ) * 100;

                const pnlPct =
                    applyFeeToPnl(
                        rawNetPnlPct,
                        assetClass,
                        resolveCostsForStrategy(id, assetClass, costs)
                    );

                return {
                    rawExitPrice:
                        rawExit,

                    exitPrice,

                    grossPnlPercent,

                    pnlPct,

                    costDragPercent:
                        pnlPct -
                        grossPnlPercent,

                    outcome:
                        pnlPct >= 0
                            ? "win"
                            : "loss",

                    closeReason:
                        "end_of_data"
                };
            })();

        spotTrades.push({
            strategy:
                id,

            label:
                STRATEGIES[id]?.label ?? id,

            side:
                position.side,

            rawEntry:
                position.rawEntryPrice,

            rawExit:
                exit.rawExitPrice ?? null,

            entry:
                position.entryPrice,

            exit:
                exit.exitPrice,

            grossPnlPercent:
                Number.isFinite(exit.grossPnlPercent)
                    ? exit.grossPnlPercent
                    : null,

            pnlPercent:
                exit.pnlPct,

            costDragPercent:
                Number.isFinite(exit.costDragPercent)
                    ? exit.costDragPercent
                    : null,

            maePercent:
                position.maxAdversePct,

            mfePercent:
                position.maxFavorablePct,

            openedAt:
                position.openedAt,

            closedAt:
                finalCandle.time,

            holdingCandles:
                position.candlesSinceOpen + 1,

            holdingMs:
                Number.isFinite(position.openedAt) &&
                Number.isFinite(finalCandle.time)
                    ? finalCandle.time - position.openedAt
                    : null,

            confidence:
                position.confidence ?? null,

            outcome:
                exit.outcome,

            closeReason:
                exit.closeReason,

            regime:
                position.regime ?? null
        });

        openPositionsMarkedToClose += 1;

        position.side = null;
        position.type = null;

        position.rawEntryPrice = null;
        position.entryPrice = null;

        position.stopLoss = null;
        position.takeProfit = null;
        position.candlesSinceOpen = 0;
        position.confidence = null;
        position.regime = null;
        position.openedAt = null;
        position.openedIndex = null;

        position.maxFavorablePct = 0;
        position.maxAdversePct = 0;
    }

    onProgress?.(total, total);

    // Any predictions still pending past the last candle simply never resolved
    // (their expiry falls beyond available data) - dropped, not guessed.
    return {
        meta: {
            candleCount: total,
            from: candles[0].time,
            to: candles.at(-1).time,
            executionModel: "risk-managed-candle",
            maxWindow,
            scoreStartIndex,
            warmupCandles: scoreStartIndex,
            strategiesRun: strategyIds.length,
            higherTimeframeApplied: usesHigherTimeframe && Array.isArray(dailyCandles) && dailyCandles.length >= 200,
            executionCostsApplied: Boolean(assetClass),
            spotTrades: spotTrades.length,
            binaryTradesResolved: resolvedBinary.length,
            binaryTradesDropped: pendingBinary.length,
            openPositionsMarkedToClose,
            openPositionsDropped
        },
        spotLeaderboard: buildSpotLeaderboard(strategyIds, spotTrades),
        // Raw chronological per-strategy trade lists, exposed so the UI
        // (or any other caller) can run rolling-performance analysis
        // (computeRollingPerformance in performanceStats.js) without
        // needing to re-run the whole backtest just to get trade-level
        // data the engine already computed.
        spotTradesByStrategy: groupTradesByStrategy(strategyIds, spotTrades),
        binaryStats: buildBinaryStats(strategyIds, resolvedBinary, expiryLengths, payoutRatio, minSampleSize)
    };
}

// Walk-forward / out-of-sample runner. A single aggregate backtest number
// can hide a strategy that only worked because one big trending month
// carried the whole sample - it says nothing about whether performance is
// stable period to period. This slices `candles` into `folds` sequential,
// non-overlapping chronological segments and runs a completely independent
// runBacktest() over each one (fresh positions/state per fold - a strategy
// doesn't carry an open position or any state across a fold boundary, and
// each fold only ever sees its own candles - no lookahead into later folds,
// and no leakage of earlier-fold trades into later-fold stats).
//
// Trade-off: each fold's indicators cold-start at its first candle rather
// than having `maxWindow` candles of lead-in history, so the first handful
// of candles in every fold (until e.g. EMA200/ADX have enough bars) won't
// generate signals. That's a deliberate simplicity-over-cleverness choice:
// a lead-in window that fed trades back into the wrong fold would be a
// worse bug than a short warm-up gap. For long folds this warm-up is a
// small fraction of the sample; keep fold candle counts well above your
// longest strategy lookback (see DEFAULT_MAX_WINDOW / signalEngine.js).
//
// With folds=2 this is a simple in-sample/out-of-sample split (first half
// vs. held-out second half). With folds>2 it's walk-forward: a leaderboard
// per period, showing whether a strategy's edge holds up across different
// market regimes or is one lucky segment away from the aggregate number.
export async function runWalkForwardBacktest(candles, options = {}) {
    const {
        folds = 4,
        dailyCandles = null,
        warmupCandles = DEFAULT_MAX_WINDOW,

        /*
         * Number of historical candles that belong to the supplied
         * dataset but are NOT part of the research sample.
         *
         * The research runner should normally fetch:
         *
         *     initialContextCandles + scoringCandles
         *
         * so Fold 1 can also receive a full warm-up window.
         */
        initialContextCandles = 0,

        ...rest
    } = options;

    if (!Array.isArray(candles) || candles.length < 2) {
        throw new Error(
            "Not enough candles for walk-forward backtest."
        );
    }

    if (!Number.isInteger(folds) || folds < 2) {
        throw new Error(
            "folds must be an integer >= 2."
        );
    }

    if (
        !Number.isInteger(warmupCandles) ||
        warmupCandles < 0
    ) {
        throw new Error(
            "warmupCandles must be an integer >= 0."
        );
    }

    if (
        !Number.isInteger(initialContextCandles) ||
        initialContextCandles < 0
    ) {
        throw new Error(
            "initialContextCandles must be an integer >= 0."
        );
    }

    if (initialContextCandles >= candles.length) {
        throw new Error(
            "initialContextCandles must be smaller than candle count."
        );
    }

    /*
     * ------------------------------------------------------------
     * RESEARCH SAMPLE
     * ------------------------------------------------------------
     */
    const scoringStart = initialContextCandles;
    const scoringCandles = candles.slice(scoringStart);

    if (scoringCandles.length < folds * 2) {
        throw new Error(
            `Not enough scoring candles for ${folds} folds. ` +
            `Need at least ${folds * 2}, got ${scoringCandles.length}.`
        );
    }

    const foldSize = Math.floor(scoringCandles.length / folds);

    const usesHigherTimeframe =
        Array.isArray(rest.strategyIds)
            ? rest.strategyIds.some(
                (id) =>
                    STRATEGIES[id]?.useHigherTimeframe
            )
            : false;

    const results = [];

    for (let f = 0; f < folds; f += 1) {
        const relativeFoldStart = f * foldSize;

        const relativeFoldEnd =
            f === folds - 1
                ? scoringCandles.length
                : relativeFoldStart + foldSize;

        const foldStart = scoringStart + relativeFoldStart;
        const foldEnd = scoringStart + relativeFoldEnd;

        const contextStart = Math.max(0, foldStart - warmupCandles);

        const foldCandles = candles.slice(contextStart, foldEnd);

        const scoreStartIndex = foldStart - contextStart;

        const foldStartTime = candles[foldStart]?.time;

        const foldDailyCandles =
            Array.isArray(dailyCandles) &&
            Number.isFinite(foldStartTime)
                ? dailyCandles.filter(
                    (dailyCandle) =>
                        Number.isFinite(
                            dailyCandle?.time
                        ) &&
                        dailyCandle.time <=
                            foldStartTime
                )
                : null;
        const closedHigherTimeframeCandles =
            countClosedHigherTimeframeCandles(
                foldDailyCandles,
                foldStartTime
            );
        const higherTimeframeReady =
            usesHigherTimeframe &&
            closedHigherTimeframeCandles >= 200;

        const result = await runBacktest(foldCandles, { ...rest, dailyCandles: foldDailyCandles, scoreStartIndex });

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

            /*
             * ------------------------------------------------------------
             * HIGHER-TIMEFRAME RESEARCH AUDIT
             * ------------------------------------------------------------
             *
             * Keep these fields separate:
             *
             * higherTimeframeCandles
             *     = candles supplied to the fold
             *
             * closedHigherTimeframeCandles
             *     = candles definitely closed before fold start
             *
             * higherTimeframeReady
             *     = enough CLOSED candles exist to initialise EMA200
             *
             * higherTimeframeApplied
             *     = this fold actually had a usable HTF filter
             */
            higherTimeframeCandles: foldDailyCandles ? foldDailyCandles.length : 0,
            closedHigherTimeframeCandles,
            higherTimeframeAvailable: closedHigherTimeframeCandles > 0,
            higherTimeframeReady,
            higherTimeframeApplied:
                usesHigherTimeframe &&
                higherTimeframeReady,

            ...result
        });
    }

    return {
        folds: results,

        summary: {
            method: "rolling-origin-out-of-sample-evaluation",

            optimizationPerformed: false,

            foldCount: folds,

            totalInputCandles: candles.length,

            initialContextCandles,

            totalScoredCandles: scoringCandles.length,

            warmupCandles,

            allFoldsHaveFullWarmup: results.every((fold) => fold.fullWarmupAvailable),

            allFoldsHaveHTFContext:
                !usesHigherTimeframe ||
                results.every(
                    (fold) =>
                        fold.higherTimeframeReady === true
                ),
            allFoldsHaveClosedHTFContext:
                !usesHigherTimeframe ||
                results.every(
                    (fold) =>
                        fold.closedHigherTimeframeCandles >= 200
                ),
            htfAudit:
                usesHigherTimeframe
                    ? {
                        requiredClosedCandles: 200,
                        allFoldsHaveClosedContext:
                            results.every(
                                (fold) =>
                                    fold.closedHigherTimeframeCandles >= 200
                            ),
                        minimumClosedCandles:
                            Math.min(
                                ...results.map(
                                    (fold) =>
                                        fold.closedHigherTimeframeCandles
                                )
                            ),
                        maximumClosedCandles:
                            Math.max(
                                ...results.map(
                                    (fold) =>
                                        fold.closedHigherTimeframeCandles
                                )
                            )
                    }
                    : {
                        requiredClosedCandles: 200,
                        allFoldsHaveClosedContext: true,
                        minimumClosedCandles: 0,
                        maximumClosedCandles: 0
                    },

            note: "Each fold is an independent chronological out-of-sample evaluation. Parameters are not optimised inside this run."
        }
    };
}

// Extracted so both buildSpotLeaderboard and callers who need the raw
// chronological trade lists (e.g. rolling-performance analysis in the UI)
// share one grouping implementation.
function groupTradesByStrategy(strategyIds, trades) {
    const byStrategy = {};
    strategyIds.forEach((id) => { byStrategy[id] = []; });
    trades.forEach((trade) => {
        if (byStrategy[trade.strategy]) byStrategy[trade.strategy].push(trade);
    });
    return byStrategy;
}

function mostCommon(values) {
    const counts = new Map();
    let best = null;
    let bestCount = 0;

    for (const value of values) {
        if (value == null) continue;
        const count = (counts.get(value) ?? 0) + 1;
        counts.set(value, count);
        if (count > bestCount) {
            bestCount = count;
            best = value;
        }
    }

    return best ?? "UNKNOWN";
}

function buildSpotLeaderboard(strategyIds, trades) {
    // Group into per-strategy chronological trade lists (trades were
    // pushed in candle order during the main loop above, so this
    // preserves that order) and hand off to performanceStats.js for the
    // expectancy/drawdown/risk-adjusted math - one shared implementation
    // instead of re-deriving profit factor, Sharpe, streaks, etc. here.
    const byStrategy = groupTradesByStrategy(strategyIds, trades);

    return strategyIds
        .map((id) => {
            const strategyTrades = byStrategy[id];
            const stats = computeStrategyStats(strategyTrades);
            return {
                strategy: id,
                label: STRATEGIES[id]?.label ?? id,
                regime: mostCommon(strategyTrades.map((trade) => trade.regime)),
                trades: stats.trades,
                winRate: stats.winRate != null ? stats.winRate * 100 : 0,
                totalPnl: stats.totalReturn,
                avgPnl: stats.trades ? stats.totalReturn / stats.trades : 0,
                maxDrawdown: stats.maxDrawdown,
                avgDrawdown: stats.avgDrawdown,
                recoveryFactor: stats.recoveryFactor,
                expectancy: stats.expectancy,
                profitFactor: stats.profitFactor,
                sharpe: stats.sharpe,
                sortino: stats.sortino,
                calmar: stats.calmar,
                longestWinStreak: stats.longestWinStreak,
                longestLossStreak: stats.longestLossStreak,
                sampleReliable: stats.sampleConfidence.reliable,
                winRateConfidenceInterval: stats.sampleConfidence.confidenceInterval
            };
        })
        .sort((a, b) => b.totalPnl - a.totalPnl);
}

function buildBinaryStats(strategyIds, resolved, expiryLengths, payoutRatio, minSampleSize) {
    const byKey = {};
    strategyIds.forEach((id) => {
        expiryLengths.forEach((expiryLength) => {
            byKey[`${id}::${expiryLength}`] = {
                strategy: id,
                label: STRATEGIES[id]?.label ?? id,
                expiryLength,
                trades: 0,
                wins: 0
            };
        });
    });

    resolved.forEach((trade) => {
        const key = `${trade.strategy}::${trade.expiryLength}`;
        const row = byKey[key];
        if (!row) return;
        row.trades += 1;
        if (trade.win) row.wins += 1;
    });

    return Object.values(byKey)
        .filter((row) => row.trades > 0)
        .map((row) => {
            const edgeStats = evaluateEdge({
                wins: row.wins,
                trades: row.trades,
                payoutRatio,
                minSampleSize
            });
            return {
                strategy: row.strategy,
                label: row.label,
                expiryLength: row.expiryLength,
                trades: row.trades,
                winRate: edgeStats.winRate !== null ? edgeStats.winRate * 100 : null,
                breakevenWinRate: edgeStats.breakeven * 100,
                edge: edgeStats.edge !== null ? edgeStats.edge * 100 : null,
                reliable: edgeStats.reliable,
                verdict: edgeStats.verdict
            };
        })
        .sort((a, b) => {
            if (a.strategy !== b.strategy) return a.strategy.localeCompare(b.strategy);
            return a.expiryLength - b.expiryLength;
        });
}

