import { generateSignal, STRATEGIES } from "@signals/signalEngine.js";
import { regimeLabel } from "@marketRegime/marketRegime.js";

const STORAGE_KEY = "dracarysfxpro-strategy-tester-v1";

// Milestone 3: session breakdown. Boundaries are the commonly-used retail
// approximations (UTC, no DST adjustment) - good enough to see whether a
// strategy behaves differently across sessions, not precise enough to be
// the last word on any single trade's timing. The London/NY overlap gets
// its own bucket rather than being folded into either session, since that
// window is usually where liquidity (and behavior) differs most.
function sessionLabel(candleTime) {
    if (!Number.isFinite(candleTime)) return "Unknown";

    const hour = new Date(candleTime).getUTCHours();

    const inLondon = hour >= 8 && hour < 17;
    const inNewYork = hour >= 13 && hour < 22;
    const inAsian = hour >= 0 && hour < 9;

    if (inLondon && inNewYork) return "London/NY Overlap";
    if (inLondon) return "London";
    if (inNewYork) return "New York";
    if (inAsian) return "Asian";
    return "Off-Session";
}

export class StrategyTester {
    constructor(strategyIds = Object.keys(STRATEGIES)) {
        this.strategyIds = strategyIds;
        this.positions = {};
        this.trades = [];
        this.currentSymbol = null;

        strategyIds.forEach((id) => {
            this.positions[id] = { side: null, entry: null, regime: null, session: null };
        });

        this.load();
    }

    setSymbol(symbol) {
        if (symbol === this.currentSymbol) return;
        this.currentSymbol = symbol;
        this.strategyIds.forEach((id) => {
            this.positions[id] = { side: null, entry: null, regime: null, session: null };
        });
        this.save();
    }

    onCandle(candles) {
        const latestCandle = candles?.at(-1);
        const session = sessionLabel(latestCandle?.time);

        this.strategyIds.forEach((id) => {
            const signal = generateSignal(candles, id);
            if (!signal.ready) return;
            if (signal.type !== "BUY" && signal.type !== "SELL") return;

            const nextSide = signal.type === "BUY" ? "long" : "short";
            const position = this.positions[id];
            const regime = regimeLabel(signal.indicators);

            if (position.side && position.side !== nextSide) {
                this.closeTrade(id, position, signal.price);
            }

            if (position.side !== nextSide) {
                position.side = nextSide;
                position.entry = signal.price;
                position.regime = regime;
                position.session = session;
                position.confidence = signal.confidence;
            }
        });

        this.save();
    }

    closeTrade(id, position, exitPrice) {
        const pnlPercent = position.side === "long"
            ? ((exitPrice - position.entry) / position.entry) * 100
            : ((position.entry - exitPrice) / position.entry) * 100;

        this.trades.push({
            strategy: id,
            label: STRATEGIES[id]?.label ?? id,
            symbol: this.currentSymbol ?? "unknown",
            side: position.side,
            entry: position.entry,
            exit: exitPrice,
            pnlPercent,
            regime: position.regime,
            session: position.session,
            confidence: position.confidence,
            closedAt: Date.now()
        });

        this.trades = this.trades.slice(-500);
        position.side = null;
        position.entry = null;
        position.regime = null;
        position.session = null;
    }

    getLeaderboard() {
        const byStrategy = {};

        this.strategyIds.forEach((id) => {
            byStrategy[id] = {
                strategy: id,
                label: STRATEGIES[id]?.label ?? id,
                trades: 0,
                wins: 0,
                totalPnl: 0
            };
        });

        this.trades.forEach((trade) => {
            const row = byStrategy[trade.strategy];
            if (!row) return;
            row.trades += 1;
            row.totalPnl += trade.pnlPercent;
            if (trade.pnlPercent > 0) row.wins += 1;
        });

        return Object.values(byStrategy)
            .map((row) => ({
                ...row,
                winRate: row.trades ? (row.wins / row.trades) * 100 : 0,
                avgPnl: row.trades ? row.totalPnl / row.trades : 0
            }))
            .sort((a, b) => b.totalPnl - a.totalPnl);
    }

    getRegimeBreakdown() {
        const byKey = {};

        this.trades.forEach((trade) => {
            const key = `${trade.strategy}::${trade.regime}`;
            if (!byKey[key]) {
                byKey[key] = {
                    strategy: trade.strategy,
                    label: trade.label,
                    regime: trade.regime,
                    trades: 0,
                    wins: 0,
                    totalPnl: 0
                };
            }
            const row = byKey[key];
            row.trades += 1;
            row.totalPnl += trade.pnlPercent;
            if (trade.pnlPercent > 0) row.wins += 1;
        });

        return Object.values(byKey)
            .map((row) => ({
                ...row,
                winRate: row.trades ? (row.wins / row.trades) * 100 : 0
            }))
            .sort((a, b) => b.totalPnl - a.totalPnl);
    }

    getSessionBreakdown() {
        const byKey = {};

        this.trades.forEach((trade) => {
            const key = `${trade.strategy}::${trade.session}`;
            if (!byKey[key]) {
                byKey[key] = {
                    strategy: trade.strategy,
                    label: trade.label,
                    session: trade.session ?? "Unknown",
                    trades: 0,
                    wins: 0,
                    totalPnl: 0
                };
            }
            const row = byKey[key];
            row.trades += 1;
            row.totalPnl += trade.pnlPercent;
            if (trade.pnlPercent > 0) row.wins += 1;
        });

        return Object.values(byKey)
            .map((row) => ({
                ...row,
                winRate: row.trades ? (row.wins / row.trades) * 100 : 0
            }))
            .sort((a, b) => b.totalPnl - a.totalPnl);
    }

    getAssetBreakdown() {
        const byKey = {};

        this.trades.forEach((trade) => {
            const key = trade.symbol ?? "unknown";
            if (!byKey[key]) {
                byKey[key] = {
                    symbol: key,
                    trades: 0,
                    wins: 0,
                    totalPnl: 0
                };
            }
            const row = byKey[key];
            row.trades += 1;
            row.totalPnl += trade.pnlPercent;
            if (trade.pnlPercent > 0) row.wins += 1;
        });

        return Object.values(byKey)
            .map((row) => ({
                ...row,
                winRate: row.trades ? (row.wins / row.trades) * 100 : 0,
                avgPnl: row.trades ? row.totalPnl / row.trades : 0
            }))
            .sort((a, b) => b.totalPnl - a.totalPnl);
    }

    reset() {
        this.trades = [];
        this.strategyIds.forEach((id) => {
            this.positions[id] = { side: null, entry: null, regime: null, session: null };
        });
        this.save();
    }

    save() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                trades: this.trades,
                positions: this.positions,
                currentSymbol: this.currentSymbol
            }));
        } catch (error) {
            console.warn("Strategy tester save failed:", error.message);
        }
    }

    load() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            this.trades = Array.isArray(parsed.trades) ? parsed.trades : [];
            this.currentSymbol = parsed.currentSymbol ?? null;
            if (parsed.positions) {
                this.strategyIds.forEach((id) => {
                    if (parsed.positions[id]) this.positions[id] = parsed.positions[id];
                });
            }
        } catch (error) {
            console.warn("Strategy tester load failed:", error.message);
        }
    }
}
