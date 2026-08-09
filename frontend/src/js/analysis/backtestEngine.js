import { generateSignal, STRATEGIES } from "@signals/signalEngine.js";
import { evaluateEdge } from "@analysis/payoutMetrics.js";
import { DEFAULT_EXPIRY_LENGTHS } from "@analysis/binaryTracker.js";
import { calculateEMA } from "@indicators/indicators.js";

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
        yieldEvery = 40
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
        spotPositions[id] = { side: null, entry: null };
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
            const exitPrice = exitCandle.close;
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
            const signal = generateSignal(windowCandles, id, { higherTrend: getHigherTrend(candleTime) });
            if (!signal.ready) return;
            if (signal.type !== "BUY" && signal.type !== "SELL") {
                lastDirection[id] = null;
                return;
            }

            // -- spot model: flip on opposite signal --
            const nextSide = signal.type === "BUY" ? "long" : "short";
            const position = spotPositions[id];

            if (position.side && position.side !== nextSide) {
                const pnlPercent = position.side === "long"
                    ? ((signal.price - position.entry) / position.entry) * 100
                    : ((position.entry - signal.price) / position.entry) * 100;
                spotTrades.push({
                    strategy: id,
                    label: STRATEGIES[id]?.label ?? id,
                    side: position.side,
                    entry: position.entry,
                    exit: signal.price,
                    pnlPercent,
                    closedAt: candleTime
                });
            }
            if (position.side !== nextSide) {
                position.side = nextSide;
                position.entry = signal.price;
            }

            // -- binary model: fresh fixed-expiry bet only on a direction change --
            if (lastDirection[id] !== signal.type) {
                lastDirection[id] = signal.type;
                expiryLengths.forEach((expiryLength) => {
                    pendingBinary.push({
                        strategy: id,
                        direction: signal.type,
                        entryPrice: signal.price,
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
            spotTrades: spotTrades.length,
            binaryTradesResolved: resolvedBinary.length,
            binaryTradesDropped: pendingBinary.length
        },
        spotLeaderboard: buildSpotLeaderboard(strategyIds, spotTrades),
        binaryStats: buildBinaryStats(strategyIds, resolvedBinary, expiryLengths, payoutRatio, minSampleSize)
    };
}

function buildSpotLeaderboard(strategyIds, trades) {
    const byStrategy = {};
    strategyIds.forEach((id) => {
        byStrategy[id] = {
            strategy: id,
            label: STRATEGIES[id]?.label ?? id,
            trades: 0,
            wins: 0,
            totalPnl: 0,
            peak: 0,
            trough: 0,
            running: 0,
            maxDrawdown: 0
        };
    });

    trades.forEach((trade) => {
        const row = byStrategy[trade.strategy];
        if (!row) return;
        row.trades += 1;
        row.totalPnl += trade.pnlPercent;
        if (trade.pnlPercent > 0) row.wins += 1;

        row.running += trade.pnlPercent;
        row.peak = Math.max(row.peak, row.running);
        row.maxDrawdown = Math.max(row.maxDrawdown, row.peak - row.running);
    });

    return Object.values(byStrategy)
        .map((row) => ({
            strategy: row.strategy,
            label: row.label,
            trades: row.trades,
            wins: row.wins,
            winRate: row.trades ? (row.wins / row.trades) * 100 : 0,
            totalPnl: row.totalPnl,
            avgPnl: row.trades ? row.totalPnl / row.trades : 0,
            maxDrawdown: row.maxDrawdown
        }))
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

