// SQLite storage for every signal the scheduler generates, win or lose.
// Uses better-sqlite3 (synchronous, no async ceremony needed for a
// single-process cron-style script like this).

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    symbol TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    strategy_label TEXT NOT NULL,
    type TEXT NOT NULL,
    confidence REAL,
    quality TEXT,
    entry_price REAL NOT NULL,
    stop_loss REAL,
    take_profit REAL,
    reward_multiple REAL,
    regime TEXT,
    reason TEXT,
    expiry_label TEXT,
    expiry_minutes REAL,
    status TEXT NOT NULL DEFAULT 'open',
    candles_since_open INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT,
    exit_price REAL,
    outcome TEXT,
    close_reason TEXT,
    pnl_pct REAL
);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_strategy ON signals(symbol, strategy_id, status);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_signals_closed_at ON signals(closed_at);
`);

// Migration for DBs created before expiry tracking existed. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so just try and ignore the "duplicate column"
// error if it's already there.
for (const col of ["expiry_label TEXT", "expiry_minutes REAL"]) {
    try {
        db.exec(`ALTER TABLE signals ADD COLUMN ${col}`);
    } catch (err) {
        if (!/duplicate column/i.test(err.message)) throw err;
    }
}

export function insertSignal(row) {
    const stmt = db.prepare(`
        INSERT INTO signals (
            created_at, symbol, asset_class, timeframe, strategy_id, strategy_label,
            type, confidence, quality, entry_price, stop_loss, take_profit,
            reward_multiple, regime, reason, expiry_label, expiry_minutes
        ) VALUES (
            @createdAt, @symbol, @assetClass, @timeframe, @strategyId, @strategyLabel,
            @type, @confidence, @quality, @entryPrice, @stopLoss, @takeProfit,
            @rewardMultiple, @regime, @reason, @expiryLabel, @expiryMinutes
        )
    `);
    return stmt.run(row).lastInsertRowid;
}

export function getOpenSignals(symbol, strategyId) {
    return db.prepare(
        `SELECT * FROM signals WHERE symbol = ? AND strategy_id = ? AND status = 'open'`
    ).all(symbol, strategyId);
}

export function getAllOpenSignals() {
    return db.prepare(`SELECT * FROM signals WHERE status = 'open' ORDER BY created_at DESC`).all();
}

export function incrementCandlesSinceOpen(id) {
    db.prepare(`UPDATE signals SET candles_since_open = candles_since_open + 1 WHERE id = ?`).run(id);
}

export function closeSignal(id, { closedAt, exitPrice, outcome, closeReason, pnlPct }) {
    db.prepare(`
        UPDATE signals
        SET status = 'closed', closed_at = @closedAt, exit_price = @exitPrice,
            outcome = @outcome, close_reason = @closeReason, pnl_pct = @pnlPct
        WHERE id = @id
    `).run({ id, closedAt, exitPrice, outcome, closeReason, pnlPct });
}

export function getClosedSignalsSince(isoDate) {
    return db.prepare(
        `SELECT * FROM signals WHERE status = 'closed' AND closed_at >= ? ORDER BY closed_at DESC`
    ).all(isoDate);
}

export function getAllClosedSignals() {
    return db.prepare(`SELECT * FROM signals WHERE status = 'closed' ORDER BY closed_at DESC`).all();
}

export default db;
