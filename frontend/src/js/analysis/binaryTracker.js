import { generateSignal, STRATEGIES } from "@signals/signalEngine.js";
import { evaluateEdge } from "@analysis/payoutMetrics.js";

const STORAGE_KEY = "dracarysfxpro-binary-tracker-v1";
const MAX_RESOLVED = 1000;

// Below this many resolved trades in a strategy/expiry bucket, the win rate
// isn't reported as a number - a percentage from a handful of trades looks
// exactly as calibrated as one from a thousand, and displaying it invites
// treating it as real when it isn't. See getBinaryStats().
const MIN_SAMPLE_SIZE = 20;

// Typical OTC short-expiry binary payout. Override per-broker via the
// payoutRatio argument to getBinaryStats() if yours differs.
const DEFAULT_PAYOUT_RATIO = 0.85;

// Expiry lengths in CANDLES, not fixed wall-clock time - a real binary
// option's "5 minute expiry" only maps to "5 candles" if the chart is on a
// 1-minute interval. The UI layer is responsible for turning a candle count
// into a human time label using the chart's actual interval; this tracker
// deliberately stays interval-agnostic.
export const DEFAULT_EXPIRY_LENGTHS = [1, 3, 5, 10, 15];

// Tracks, per strategy and per candle-count "expiry", whether a signal's
// direction would have won a binary-style bet: did price close above entry
// after N candles for a BUY, or below entry for a SELL. This is the
// mechanism only - it produces a real win rate once enough trades have
// resolved, and reports "not enough data" rather than guessing before that.
// It never fabricates a placeholder percentage; every number here is
// computed from an actual recorded entry price and an actual recorded exit
// price.
//
// A new prediction is only recorded when a strategy's directional call
// CHANGES (mirrors how StrategyTester only opens a new position on a side
// flip) rather than on every candle a signal stays active. Recording one
// every single candle would stack up highly correlated, near-duplicate
// bets on the same underlying move and make the win-rate sample size look
// far larger and more independent than it actually is - the same "too many
// buckets, most of it is noise" trap flagged for the Learning Engine.
export class BinaryOutcomeTracker {
    constructor(strategyIds = Object.keys(STRATEGIES), expiryLengths = DEFAULT_EXPIRY_LENGTHS) {
        this.strategyIds = strategyIds;
        this.expiryLengths = expiryLengths;
        this.pending = [];
        this.resolved = [];
        this.lastDirection = {};
        this.currentSymbol = null;

        strategyIds.forEach((id) => {
            this.lastDirection[id] = null;
        });

        this.load();
    }

    setSymbol(symbol) {
        if (symbol === this.currentSymbol) return;
        this.currentSymbol = symbol;
        this.pending = [];
        this.strategyIds.forEach((id) => {
            this.lastDirection[id] = null;
        });
        this.save();
    }

    onCandle(candles) {
        if (!Array.isArray(candles) || !candles.length) return;
        const currentIndex = candles.length - 1;

        // 1. Resolve any pending predictions whose expiry has arrived.
        const stillPending = [];
        for (const prediction of this.pending) {
            const targetIndex = prediction.entryIndex + prediction.expiryLength;
            if (targetIndex > currentIndex) {
                stillPending.push(prediction);
                continue;
            }

            const exitCandle = candles[targetIndex];
            if (!exitCandle) {
                // Candle history got trimmed before this could resolve - drop
                // it rather than guessing an outcome we don't actually have.
                continue;
            }

            const exitPrice = exitCandle.close;
            const win = prediction.direction === "BUY"
                ? exitPrice > prediction.entryPrice
                : exitPrice < prediction.entryPrice;

            this.resolved.push({
                strategy: prediction.strategy,
                label: STRATEGIES[prediction.strategy]?.label ?? prediction.strategy,
                expiryLength: prediction.expiryLength,
                direction: prediction.direction,
                entryPrice: prediction.entryPrice,
                exitPrice,
                win,
                resolvedAt: Date.now()
            });
        }
        this.pending = stillPending;
        this.resolved = this.resolved.slice(-MAX_RESOLVED);

        // 2. Record a fresh prediction bundle (one per expiry length) only
        // when a strategy's directional call changes.
        this.strategyIds.forEach((id) => {
            const signal = generateSignal(candles, id);
            if (!signal.ready) return;

            if (signal.type !== "BUY" && signal.type !== "SELL") {
                this.lastDirection[id] = null;
                return;
            }

            if (this.lastDirection[id] === signal.type) return;
            this.lastDirection[id] = signal.type;

            this.expiryLengths.forEach((expiryLength) => {
                this.pending.push({
                    strategy: id,
                    direction: signal.type,
                    entryPrice: signal.price,
                    entryIndex: currentIndex,
                    expiryLength
                });
            });
        });

        this.save();
    }

    // Real, empirical stats only. A bucket with fewer than minSampleSize
    // resolved trades reports reliable: false and a null winRate instead of
    // a misleadingly precise-looking percentage - callers should show
    // "not enough data yet (n/min)" for those rather than a number.
    //
    // Each row also carries the payout-aware verdict from payoutMetrics.js:
    // breakeven (the win rate needed just to not lose money at this
    // payout), edge (winRate - breakeven), a 95% confidence interval on the
    // true win rate, and a plain-language verdict. Trust the verdict over
    // eyeballing winRate vs. 50% - 50% is the wrong bar for binary options.
    getBinaryStats(minSampleSize = MIN_SAMPLE_SIZE, payoutRatio = DEFAULT_PAYOUT_RATIO) {
        const byKey = {};

        this.resolved.forEach((trade) => {
            const key = `${trade.strategy}::${trade.expiryLength}`;
            if (!byKey[key]) {
                byKey[key] = {
                    strategy: trade.strategy,
                    label: trade.label,
                    expiryLength: trade.expiryLength,
                    trades: 0,
                    wins: 0
                };
            }
            byKey[key].trades += 1;
            if (trade.win) byKey[key].wins += 1;
        });

        return Object.values(byKey)
            .map((row) => {
                const reliable = row.trades >= minSampleSize;
                const edgeStats = evaluateEdge({
                    wins: row.wins,
                    trades: row.trades,
                    payoutRatio,
                    minSampleSize
                });
                return {
                    ...row,
                    winRate: reliable ? (row.wins / row.trades) * 100 : null,
                    reliable,
                    minSampleSize,
                    payoutRatio,
                    breakevenWinRate: edgeStats.breakeven * 100,
                    edge: edgeStats.edge !== null ? edgeStats.edge * 100 : null,
                    confidenceInterval: edgeStats.ci
                        ? { lower: edgeStats.ci.lower * 100, upper: edgeStats.ci.upper * 100 }
                        : null,
                    verdict: edgeStats.verdict
                };
            })
            .sort((a, b) => {
                if (a.strategy !== b.strategy) return a.strategy.localeCompare(b.strategy);
                return a.expiryLength - b.expiryLength;
            });
    }

    reset() {
        this.pending = [];
        this.resolved = [];
        this.strategyIds.forEach((id) => {
            this.lastDirection[id] = null;
        });
        this.save();
    }

    save() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                pending: this.pending,
                resolved: this.resolved,
                lastDirection: this.lastDirection,
                currentSymbol: this.currentSymbol
            }));
        } catch (error) {
            console.warn("Binary tracker save failed:", error.message);
        }
    }

    load() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            this.pending = Array.isArray(parsed.pending) ? parsed.pending : [];
            this.resolved = Array.isArray(parsed.resolved) ? parsed.resolved : [];
            this.currentSymbol = parsed.currentSymbol ?? null;
            if (parsed.lastDirection) {
                this.strategyIds.forEach((id) => {
                    if (id in parsed.lastDirection) this.lastDirection[id] = parsed.lastDirection[id];
                });
            }
        } catch (error) {
            console.warn("Binary tracker load failed:", error.message);
        }
    }
}
