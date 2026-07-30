// Demo Account (v2): the persisted, broker-style account that every real
// signal you act on actually updates — balance, equity, margin, win rate,
// streaks, drawdown. This module owns the numbers; tradeEngine.js is the
// only thing that should mutate trades/closedTrades on it (via
// openPosition/closePosition), so all math stays in one place.

const STORAGE_KEY = "dracarysfxpro-demo-account-v2";

function freshAccount() {
    return {
        balance: 10000,
        equity: 10000,
        startingBalance: 10000,
        marginUsed: 0,
        leverage: 1, // 1x = no margin trading; bump this later if you add leveraged sizing
        wins: 0,
        losses: 0,
        trades: [],        // open positions
        closedTrades: [],  // resolved trades, newest first
        journal: [],        // narrative journal entries, newest first (see journal.js)
        strategyStats: {},
        highestBalance: 10000,
        maxDrawdown: 0,     // percent, worst peak-to-trough seen
        streak: 0,          // positive = current win streak, negative = current lose streak
        longestWinStreak: 0,
        longestLoseStreak: 0,
        createdAt: Date.now()
    };
}

class DemoAccount {
    constructor() {
        this.account = this.load();
        this.listeners = new Set();
    }

    load() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                // Merge over freshAccount() so any fields added in later
                // versions of this module still get sane defaults for
                // accounts that were saved before those fields existed.
                return { ...freshAccount(), ...JSON.parse(saved) };
            }
        } catch {
            // Corrupt or inaccessible storage — fall back to a clean account
            // rather than throwing and breaking the whole dashboard.
        }
        return freshAccount();
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.account));
        } catch {
            // Storage can throw in private browsing / over quota — the
            // account still works for the rest of the session, it just
            // won't persist across reloads.
        }
        this.emit();
    }

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit() {
        this.listeners.forEach((fn) => fn(this.account));
    }

    reset() {
        this.account = freshAccount();
        this.save();
    }

    get() {
        return this.account;
    }

    deposit(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.account.balance += amount;
        this.account.equity = this.account.balance;
        this.save();
    }

    withdraw(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.account.balance -= amount;
        this.account.equity = this.account.balance;
        this.save();
    }

    getTotalTrades() {
        return this.account.wins + this.account.losses;
    }

    getWinRate() {
        const total = this.getTotalTrades();
        if (total === 0) return 0;
        return Number(((this.account.wins / total) * 100).toFixed(1));
    }

    getNetProfit() {
        return this.account.balance - this.account.startingBalance;
    }

    getROI() {
        return Number(
            (((this.account.balance - this.account.startingBalance) / this.account.startingBalance) * 100).toFixed(2)
        );
    }

    getFreeMargin() {
        return this.account.equity - this.account.marginUsed;
    }

    // Recomputes margin used from currently open positions. Called by
    // tradeEngine after every open/close so marginUsed never drifts out of
    // sync with the actual open trade list.
    recalcMargin() {
        const leverage = this.account.leverage || 1;
        this.account.marginUsed = this.account.trades.reduce((sum, t) => {
            const notional = (t.entryPrice ?? 0) * (t.quantity ?? 0);
            return sum + notional / leverage;
        }, 0);
    }

    // Marks open positions to market so Equity/Free Margin move live between
    // trade closes, not just when a trade resolves. pricesBySymbol looks
    // like { "btcusdt": 60123.4 }.
    markToMarket(pricesBySymbol) {
        if (!this.account.trades.length) {
            this.account.equity = this.account.balance;
            return;
        }
        let unrealized = 0;
        for (const t of this.account.trades) {
            const price = pricesBySymbol[t.symbol];
            if (!Number.isFinite(price)) continue;
            unrealized += t.side === "long"
                ? (price - t.entryPrice) * t.quantity
                : (t.entryPrice - price) * t.quantity;
        }
        this.account.equity = this.account.balance + unrealized;
        this.updateDrawdown();
    }

    updateDrawdown() {
        if (this.account.equity > this.account.highestBalance) {
            this.account.highestBalance = this.account.equity;
        }
        if (this.account.highestBalance <= 0) return;
        const dd = ((this.account.highestBalance - this.account.equity) / this.account.highestBalance) * 100;
        if (dd > this.account.maxDrawdown) {
            this.account.maxDrawdown = Number(dd.toFixed(2));
        }
    }
}

export default new DemoAccount();
