import { generateSignal, STRATEGIES } from "@signals/signalEngine.js";
import { evaluateEdge } from "@analysis/payoutMetrics.js";
import { DEFAULT_EXPIRY_LENGTHS } from "@analysis/binaryTracker.js";
import { calculateEMA } from "@indicators/indicators.js";
import { applyExitCost } from "@analysis/executionCosts.js";
import { createEntryFill, evaluateCandleExit } from "@analysis/executionSimulator.js";
import { computeStrategyStats } from "@analysis/performanceStats.js";

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
//   - "spot": a running position that flips on the opposite signal and
//     realizes % PnL on the flip (mirrors StrategyTester).
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

    const closes = dailyCandles.map((c) => c.close);
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);
    const offset50 = closes.length - ema50.length;
    const offset200 = closes.length - ema200.length;

    // One trend value per daily candle index (aligned to `dailyCandles`),
    // available starting the candle *after* the one that closes it.
    const trendByIndex = dailyCandles.map((_, i) => {
        const e50 = ema50[i - offset50];
        const e200 = ema200[i - offset200];
        if (!Number.isFinite(e50) || !Number.isFinite(e200)) return "NEUTRAL";
        if (e50 > e200) return "UP";
        if (e50 < e200) return "DOWN";
        return "NEUTRAL";
    });

    const ONE_DAY_MS = 86_400_000;

    return (timestamp) => {
        // Find the last daily candle that had fully closed before `timestamp`.
        let lo = 0, hi = dailyCandles.length - 1, result = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (dailyCandles[mid].time + ONE_DAY_MS <= timestamp) {
                result = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return result === -1 ? "NEUTRAL" : trendByIndex[result];
    };
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
        extraSignalContext = {}
    } = options;

    if (!Array.isArray(candles) || candles.length < 2) {
        throw new Error("Not enough candles to backtest (need at least 2).");
    }

    const getHigherTrend = buildHigherTimeframeLookup(dailyCandles);
    const usesHigherTimeframe = strategyIds.some((id) => STRATEGIES[id]?.useHigherTimeframe);
    if (usesHigherTimeframe && !dailyCandles) {
        console.warn(
            "[backtestEngine] One or more strategies use useHigherTimeframe, but no " +
            "`dailyCandles` were passed to runBacktest(). The HTF filter will be a " +
            "no-op (always NEUTRAL), which does not match how these strategies " +
            "behave live - pass daily candles for the same symbol to get accurate results."
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
            entryPrice: null,
            stopLoss: null,
            takeProfit: null,
            candlesSinceOpen: 0,
            confidence: null,
            regime: null
        };
        lastDirection[id] = null;
    });

    const total = candles.length;

    for (let i = 0; i < total; i++) {
        // 1. Resolve any binary predictions whose expiry has arrived at this index.
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
                ? applyExitCost(exitCandle.close, prediction.direction, assetClass, costs)
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

        // 2. Build the same rolling window the live app would have had at this point.
        const windowStart = Math.max(0, i - maxWindow + 1);
        const windowCandles = candles.slice(windowStart, i + 1);
        const candleTime = candles[i].time;

        // 3. One generateSignal() call per strategy per candle, shared by both models.
        strategyIds.forEach((id) => {
            const signal = generateSignal(windowCandles, id, { higherTrend: getHigherTrend(candleTime), ...extraSignalContext });
            const position = spotPositions[id];

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

                const exit = evaluateCandleExit({
                    position: {
                        type: position.type,
                        entryPrice: position.entryPrice,
                        stopLoss: position.stopLoss,
                        takeProfit: position.takeProfit
                    },
                    candle: candles[i],
                    candlesSinceOpen: position.candlesSinceOpen,
                    maxHoldCandles,
                    ambiguousFillRule,
                    assetClass,
                    costs
                });

                if (exit) {
                    spotTrades.push({
                        strategy: id,
                        label: STRATEGIES[id]?.label ?? id,
                        side: position.side,
                        entry: position.entryPrice,
                        exit: exit.exitPrice,
                        pnlPercent: exit.pnlPct,
                        openedAt: position.openedAt,
                        closedAt: candleTime,
                        confidence: position.confidence ?? null,
                        outcome: exit.outcome,
                        closeReason: exit.closeReason,
                        regime: position.regime ?? null
                    });

                    position.side = null;
                    position.type = null;
                    position.entryPrice = null;
                    position.stopLoss = null;
                    position.takeProfit = null;
                    position.candlesSinceOpen = 0;
                    position.confidence = null;
                    position.regime = null;
                    position.openedAt = null;
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
                position.entryPrice = createEntryFill({
                    signal: { type: signal.type, price: rawPrice },
                    assetClass,
                    costs
                });
                position.stopLoss = signal.risk?.stopLoss ?? null;
                position.takeProfit = signal.risk?.takeProfit ?? null;
                position.candlesSinceOpen = 0;
                position.confidence = Number.isFinite(signal.confidence)
                    ? signal.confidence
                    : null;
                position.regime = signal.regime?.primary ?? null;
                position.openedAt = candleTime;
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
                    costs
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

    onProgress?.(total, total);

    // Any predictions still pending past the last candle simply never resolved
    // (their expiry falls beyond available data) - dropped, not guessed.
    return {
        meta: {
            candleCount: total,
            from: candles[0].time,
            to: candles.at(-1).time,
            maxWindow,
            strategiesRun: strategyIds.length,
            higherTimeframeApplied: Boolean(dailyCandles),
            executionCostsApplied: Boolean(assetClass),
            spotTrades: spotTrades.length,
            binaryTradesResolved: resolvedBinary.length,
            binaryTradesDropped: pendingBinary.length
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
    const { folds = 4, dailyCandles = null, ...rest } = options;

    if (!Array.isArray(candles) || candles.length < folds * 2) {
        throw new Error(`Not enough candles for ${folds} walk-forward folds.`);
    }

    const foldSize = Math.floor(candles.length / folds);
    const results = [];

    for (let f = 0; f < folds; f++) {
        const foldStart = f * foldSize;
        const foldEnd = f === folds - 1 ? candles.length : foldStart + foldSize;
        const foldCandles = candles.slice(foldStart, foldEnd);

        // dailyCandles for HTF context should only include days that had
        // already closed before this fold's own start, mirroring what a
        // live deployment restarted at that point in time would have seen.
        const foldDailyCandles = dailyCandles
            ? dailyCandles.filter((d) => d.time <= candles[foldStart].time)
            : null;

        const result = await runBacktest(foldCandles, { ...rest, dailyCandles: foldDailyCandles });

        results.push({
            fold: f + 1,
            from: foldCandles[0].time,
            to: foldCandles.at(-1).time,
            candleCount: foldCandles.length,
            ...result
        });
    }

    return {
        folds: results,
        summary: {
            foldCount: folds,
            totalCandles: candles.length,
            note: "Each fold is an independent, non-overlapping, chronological out-of-sample slice. Compare spotLeaderboard.totalPnl and binaryStats.edge across folds - a strategy whose numbers hold up across most folds is more trustworthy than one whose aggregate is dominated by a single fold."
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

