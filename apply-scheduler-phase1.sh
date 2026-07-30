#!/usr/bin/env bash
# apply-scheduler-phase1.sh
#
# Adds a background scheduler to OTC Signal AI Pro:
#   - polls configured symbols on an interval
#   - runs your EXISTING signalEngine.js (all 14 strategies, unmodified)
#     against fresh candles via vite-node, so it reuses the real
#     indicator/pattern/smart-money logic instead of reimplementing it
#   - opens/closes virtual (paper) trades against each strategy's own
#     ATR-based stop-loss/take-profit
#   - logs every signal to a local SQLite file
#   - generates a daily HTML report you can open after school
#
# Run from your project root (the folder containing frontend/, backend/,
# package.json):
#   chmod +x apply-scheduler-phase1.sh
#   ./apply-scheduler-phase1.sh
#
# This only touches frontend/. It does not modify signalEngine.js or any
# other existing file except frontend/package.json (adds deps + 2 scripts)
# and frontend/.gitignore (adds data/ and reports/).

set -euo pipefail

if [ ! -d "frontend/src/js/signals" ]; then
    echo "Run this from your project root (frontend/src/js/signals not found here)." >&2
    exit 1
fi

mkdir -p frontend/scripts/scheduler frontend/data frontend/reports

echo "Writing scheduler files..."

cat > frontend/scripts/scheduler/config.js << 'FILEEOF'
// Central config for the background scheduler. Edit this file to change
// which markets get scanned, how often, and when the daily report fires.
// Nothing else in scripts/scheduler/ should need touching for day-to-day
// tuning.

export const config = {
    // Symbols to scan every cycle. `assetClass: "crypto"` uses Binance via
    // ccxt (no API key needed for public candle data). `assetClass: "forex"`
    // uses Twelve Data (needs TWELVEDATA_API_KEY in frontend/.env - same key
    // your browser app already uses for forexDataService.js) and is subject
    // to the free tier's 800 calls/day, 8/min budget - see that file's notes
    // before adding many forex symbols on a short poll interval.
    symbols: [
        { symbol: "BTC/USDT", assetClass: "crypto" },
        { symbol: "ETH/USDT", assetClass: "crypto" }
        // { symbol: "EUR/USD", assetClass: "forex" },
    ],

    timeframe: "1m",

    // Needs to cover the longest strategy lookback in signalEngine.js
    // (trendFollowing2 wants 220 candles). 250 leaves headroom.
    candleLimit: 250,

    // Which STRATEGIES keys (from signalEngine.js) to run each cycle.
    // Empty array = run all of them.
    strategies: [],

    // How often to re-scan for new signals and check open ones, in ms.
    // 60_000 = once a minute. Binance's public REST endpoint doesn't
    // require a key, but don't go far below this without checking their
    // rate limits for however many symbols you're scanning.
    pollIntervalMs: 60_000,

    // A virtual trade that hits neither its stop nor its target within this
    // many poll cycles gets closed as a "timeout" (win or loss decided by
    // whichever side of entry price it's sitting on when time runs out).
    maxHoldCandles: 60,

    // 24h local time the daily HTML report auto-generates.
    dailyReportHour: 18,
    dailyReportMinute: 0,

    dbPath: new URL("../../data/signals.db", import.meta.url).pathname,
    reportsDir: new URL("../../reports", import.meta.url).pathname
};
FILEEOF

cat > frontend/scripts/scheduler/candles.js << 'FILEEOF'
// Candle fetching, kept separate from runScheduler.js so the data source
// can be swapped or mocked without touching scheduling/trade logic.
// Crypto goes through ccxt/Binance (public REST, no key). Forex goes
// through Twelve Data's REST time_series endpoint directly - not through
// frontend/src/js/services/forexDataService.js, because that class is
// built around a live poll-and-callback loop for the browser UI
// (import.meta.env, WebSocket-style subscriptions); this just needs a
// single one-shot fetch per cycle, so a plain REST call is simpler and has
// no browser-only assumptions baked in.

import ccxt from "ccxt";

const TWELVEDATA_INTERVAL = {
    "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "1d": "1day"
};

const binance = new ccxt.binance();

export async function fetchCandles({ symbol, assetClass, timeframe, limit }) {
    return assetClass === "forex"
        ? fetchForexCandles({ symbol, timeframe, limit })
        : fetchCryptoCandles({ symbol, timeframe, limit });
}

async function fetchCryptoCandles({ symbol, timeframe, limit }) {
    const ohlcv = await binance.fetchOHLCV(symbol, timeframe, undefined, limit);
    return ohlcv.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
}

async function fetchForexCandles({ symbol, timeframe, limit }) {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
        throw new Error(`TWELVEDATA_API_KEY not set - required to scan forex symbol ${symbol}`);
    }
    const interval = TWELVEDATA_INTERVAL[timeframe] ?? "1min";
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${limit}&apikey=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "error") throw new Error(data.message || `Twelve Data error for ${symbol}`);
    if (!Array.isArray(data.values)) throw new Error(`Unexpected Twelve Data response for ${symbol}`);

    return data.values
        .map(v => ({
            time: new Date(v.datetime).getTime(),
            open: Number(v.open),
            high: Number(v.high),
            low: Number(v.low),
            close: Number(v.close),
            volume: Number(v.volume ?? 0)
        }))
        .reverse(); // Twelve Data returns newest-first; signalEngine expects oldest-first
}
FILEEOF

cat > frontend/scripts/scheduler/virtualTrades.js << 'FILEEOF'
// Pure decision functions for opening/closing virtual (paper) trades based
// on signalEngine output. No IO here on purpose — db.js and candles.js are
// the only modules that touch disk/network, so this logic can be unit
// tested and reasoned about on its own.

export function shouldOpen(signal) {
    return (signal.type === "BUY" || signal.type === "SELL") && signal.ready !== false;
}

// openTrade: { type, stopLoss, takeProfit, entryPrice }
export function checkExit(openTrade, latestPrice, candlesSinceOpen, maxHoldCandles) {
    const { type, stopLoss, takeProfit, entryPrice } = openTrade;

    if (type === "BUY") {
        if (Number.isFinite(takeProfit) && latestPrice >= takeProfit) {
            return buildClose("win", "take_profit", entryPrice, latestPrice, type);
        }
        if (Number.isFinite(stopLoss) && latestPrice <= stopLoss) {
            return buildClose("loss", "stop_loss", entryPrice, latestPrice, type);
        }
    } else if (type === "SELL") {
        if (Number.isFinite(takeProfit) && latestPrice <= takeProfit) {
            return buildClose("win", "take_profit", entryPrice, latestPrice, type);
        }
        if (Number.isFinite(stopLoss) && latestPrice >= stopLoss) {
            return buildClose("loss", "stop_loss", entryPrice, latestPrice, type);
        }
    }

    if (candlesSinceOpen >= maxHoldCandles) {
        const pnlPct = pnlPercent(type, entryPrice, latestPrice);
        return buildClose(pnlPct >= 0 ? "win" : "loss", "timeout", entryPrice, latestPrice, type, pnlPct);
    }

    return null; // still open
}

function pnlPercent(type, entryPrice, exitPrice) {
    const raw = type === "BUY"
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;
    return raw * 100;
}

function buildClose(outcome, closeReason, entryPrice, exitPrice, type, precomputedPnl) {
    return {
        outcome,
        closeReason,
        exitPrice,
        pnlPct: precomputedPnl ?? pnlPercent(type, entryPrice, exitPrice)
    };
}
FILEEOF

cat > frontend/scripts/scheduler/db.js << 'FILEEOF'
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

export function insertSignal(row) {
    const stmt = db.prepare(`
        INSERT INTO signals (
            created_at, symbol, asset_class, timeframe, strategy_id, strategy_label,
            type, confidence, quality, entry_price, stop_loss, take_profit,
            reward_multiple, regime, reason
        ) VALUES (
            @createdAt, @symbol, @assetClass, @timeframe, @strategyId, @strategyLabel,
            @type, @confidence, @quality, @entryPrice, @stopLoss, @takeProfit,
            @rewardMultiple, @regime, @reason
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
FILEEOF

cat > frontend/scripts/scheduler/report.js << 'FILEEOF'
// Pure functions: turn rows of closed/open signals into report data, then
// into an HTML string. No IO here - generateReport.js (the DB-touching,
// file-writing wrapper) is the only thing that calls fs or db.js. Keeping
// this side-effect-free means it can be tested with plain arrays.

export function buildReportData(closedRows, openRows, dateLabel) {
    const totalTrades = closedRows.length;
    const wins = closedRows.filter(r => r.outcome === "win").length;
    const losses = totalTrades - wins;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;

    const totalPnlPct = sum(closedRows.map(r => r.pnl_pct ?? 0));
    const avgPnlPct = totalTrades ? totalPnlPct / totalTrades : 0;

    const grossWin = sum(closedRows.filter(r => (r.pnl_pct ?? 0) > 0).map(r => r.pnl_pct));
    const grossLoss = Math.abs(sum(closedRows.filter(r => (r.pnl_pct ?? 0) < 0).map(r => r.pnl_pct)));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);

    const strategyLeaderboard = groupAndScore(closedRows, r => r.strategy_label);
    const symbolStats = groupAndScore(closedRows, r => r.symbol);

    const bestStrategy = strategyLeaderboard[0] ?? null;
    const worstStrategy = strategyLeaderboard.length ? strategyLeaderboard.at(-1) : null;
    const mostActiveSymbol = [...symbolStats].sort((a, b) => b.trades - a.trades)[0] ?? null;

    const topSignals = [...closedRows]
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .slice(0, 10);

    const openHighConfidence = [...openRows]
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .slice(0, 10);

    return {
        dateLabel,
        totalTrades,
        wins,
        losses,
        winRate,
        totalPnlPct,
        avgPnlPct,
        profitFactor,
        strategyLeaderboard,
        symbolStats,
        bestStrategy,
        worstStrategy,
        mostActiveSymbol,
        topSignals,
        openHighConfidence,
        openCount: openRows.length
    };
}

function groupAndScore(rows, keyFn) {
    const groups = new Map();
    for (const r of rows) {
        const key = keyFn(r) ?? "unknown";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    return [...groups.entries()]
        .map(([key, trades]) => {
            const wins = trades.filter(t => t.outcome === "win").length;
            const totalPnl = sum(trades.map(t => t.pnl_pct ?? 0));
            return {
                key,
                trades: trades.length,
                wins,
                losses: trades.length - wins,
                winRate: trades.length ? (wins / trades.length) * 100 : 0,
                totalPnl,
                avgPnl: trades.length ? totalPnl / trades.length : 0
            };
        })
        .sort((a, b) => b.totalPnl - a.totalPnl);
}

function sum(arr) {
    return arr.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

export function renderReportHtml(data) {
    const pct = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : "-");
    const pnlClass = n => (n >= 0 ? "pos" : "neg");

    const leaderboardRows = data.strategyLeaderboard.map(s => `
        <tr>
            <td>${escapeHtml(s.key)}</td>
            <td>${s.trades}</td>
            <td>${s.wins}/${s.losses}</td>
            <td>${pct(s.winRate)}%</td>
            <td class="${pnlClass(s.totalPnl)}">${s.totalPnl >= 0 ? "+" : ""}${pct(s.totalPnl)}%</td>
            <td class="${pnlClass(s.avgPnl)}">${s.avgPnl >= 0 ? "+" : ""}${pct(s.avgPnl, 2)}%</td>
        </tr>`).join("");

    const symbolRows = data.symbolStats.map(s => `
        <tr>
            <td>${escapeHtml(s.key)}</td>
            <td>${s.trades}</td>
            <td>${pct(s.winRate)}%</td>
            <td class="${pnlClass(s.totalPnl)}">${s.totalPnl >= 0 ? "+" : ""}${pct(s.totalPnl)}%</td>
        </tr>`).join("");

    const signalRows = data.topSignals.map(t => `
        <tr>
            <td>${formatTime(t.closed_at)}</td>
            <td>${escapeHtml(t.symbol)}</td>
            <td>${escapeHtml(t.strategy_label)}</td>
            <td><span class="badge ${t.type === "BUY" ? "buy" : "sell"}">${t.type}</span></td>
            <td>${t.confidence ?? "-"}</td>
            <td>${escapeHtml(t.outcome ?? "-")} <span class="muted">(${escapeHtml(t.close_reason ?? "-")})</span></td>
            <td class="${pnlClass(t.pnl_pct ?? 0)}">${(t.pnl_pct ?? 0) >= 0 ? "+" : ""}${pct(t.pnl_pct, 2)}%</td>
            <td class="reason">${escapeHtml(t.reason ?? "")}</td>
        </tr>`).join("");

    const openRows = data.openHighConfidence.map(t => `
        <tr>
            <td>${formatTime(t.created_at)}</td>
            <td>${escapeHtml(t.symbol)}</td>
            <td>${escapeHtml(t.strategy_label)}</td>
            <td><span class="badge ${t.type === "BUY" ? "buy" : "sell"}">${t.type}</span></td>
            <td>${t.confidence ?? "-"}</td>
            <td>${t.entry_price}</td>
            <td>${t.stop_loss ?? "-"}</td>
            <td>${t.take_profit ?? "-"}</td>
            <td class="reason">${escapeHtml(t.reason ?? "")}</td>
        </tr>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>OTC Signal AI Pro — Daily Report — ${escapeHtml(data.dateLabel)}</title>
<style>
    :root {
        --bg: #0d1117; --panel: #161b22; --border: #30363d; --text: #e6edf3;
        --muted: #8b949e; --pos: #3fb950; --neg: #f85149; --accent: #58a6ff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; background: var(--bg); color: var(--text);
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .subtitle { color: var(--muted); margin-bottom: 28px; font-size: 14px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px; margin-bottom: 28px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
        padding: 16px; }
    .card .label { color: var(--muted); font-size: 12px; text-transform: uppercase;
        letter-spacing: 0.05em; margin-bottom: 6px; }
    .card .value { font-size: 24px; font-weight: 600; }
    .pos { color: var(--pos); } .neg { color: var(--neg); }
    section { margin-bottom: 32px; }
    h2 { font-size: 15px; color: var(--accent); text-transform: uppercase;
        letter-spacing: 0.04em; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px;
        border-bottom: 1px solid var(--border); }
    td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge.buy { background: rgba(63,185,80,0.15); color: var(--pos); }
    .badge.sell { background: rgba(248,81,73,0.15); color: var(--neg); }
    .muted { color: var(--muted); }
    .reason { color: var(--muted); max-width: 320px; }
    .empty { color: var(--muted); font-style: italic; padding: 12px 0; }
</style>
</head>
<body>
    <h1>OTC Signal AI Pro — Daily Report</h1>
    <div class="subtitle">${escapeHtml(data.dateLabel)} &middot; generated ${new Date().toLocaleString()}</div>

    <div class="cards">
        <div class="card"><div class="label">Closed Trades</div><div class="value">${data.totalTrades}</div></div>
        <div class="card"><div class="label">Win Rate</div><div class="value">${pct(data.winRate)}%</div></div>
        <div class="card"><div class="label">Wins / Losses</div><div class="value">${data.wins} / ${data.losses}</div></div>
        <div class="card"><div class="label">Total P/L</div><div class="value ${pnlClass(data.totalPnlPct)}">${data.totalPnlPct >= 0 ? "+" : ""}${pct(data.totalPnlPct)}%</div></div>
        <div class="card"><div class="label">Profit Factor</div><div class="value">${data.profitFactor === Infinity ? "∞" : pct(data.profitFactor, 2)}</div></div>
        <div class="card"><div class="label">Still Open</div><div class="value">${data.openCount}</div></div>
    </div>

    <section>
        <h2>Strategy Leaderboard</h2>
        ${data.strategyLeaderboard.length ? `
        <table>
            <thead><tr><th>Strategy</th><th>Trades</th><th>W/L</th><th>Win Rate</th><th>Total P/L</th><th>Avg P/L</th></tr></thead>
            <tbody>${leaderboardRows}</tbody>
        </table>` : `<div class="empty">No closed trades yet today.</div>`}
    </section>

    <section>
        <h2>By Symbol</h2>
        ${data.symbolStats.length ? `
        <table>
            <thead><tr><th>Symbol</th><th>Trades</th><th>Win Rate</th><th>Total P/L</th></tr></thead>
            <tbody>${symbolRows}</tbody>
        </table>` : `<div class="empty">No closed trades yet today.</div>`}
    </section>

    <section>
        <h2>Today's Trades (highest confidence first)</h2>
        ${data.topSignals.length ? `
        <table>
            <thead><tr><th>Closed</th><th>Symbol</th><th>Strategy</th><th>Side</th><th>Conf.</th><th>Outcome</th><th>P/L</th><th>Reason</th></tr></thead>
            <tbody>${signalRows}</tbody>
        </table>` : `<div class="empty">No closed trades yet today.</div>`}
    </section>

    <section>
        <h2>Still Open — Highest Confidence</h2>
        ${data.openHighConfidence.length ? `
        <table>
            <thead><tr><th>Opened</th><th>Symbol</th><th>Strategy</th><th>Side</th><th>Conf.</th><th>Entry</th><th>Stop</th><th>Target</th><th>Reason</th></tr></thead>
            <tbody>${openRows}</tbody>
        </table>` : `<div class="empty">Nothing open right now.</div>`}
    </section>
</body>
</html>`;
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function formatTime(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
FILEEOF

cat > frontend/scripts/scheduler/generateReport.js << 'FILEEOF'
// IO wrapper around report.js's pure functions: pulls today's closed
// signals + all still-open signals from SQLite, builds the report data,
// renders HTML, writes it to disk. Callable both from the scheduler's
// daily cron and manually via `npm run report`.

import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { getClosedSignalsSince, getAllOpenSignals } from "./db.js";
import { buildReportData, renderReportHtml } from "./report.js";

export function generateReport({ date = new Date() } = {}) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const closedRows = getClosedSignalsSince(startOfDay.toISOString());
    const openRows = getAllOpenSignals();

    const dateLabel = date.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    const data = buildReportData(closedRows, openRows, dateLabel);
    const html = renderReportHtml(data);

    fs.mkdirSync(config.reportsDir, { recursive: true });
    const filename = `report-${date.toISOString().slice(0, 10)}.html`;
    const filepath = path.join(config.reportsDir, filename);
    fs.writeFileSync(filepath, html);

    return filepath;
}
FILEEOF

cat > frontend/scripts/scheduler/cli-report.js << 'FILEEOF'
// One-off manual report generation, for testing or generating a report
// on demand outside the daily cron schedule.
//   npx vite-node -c vite.config.js scripts/scheduler/cli-report.js
import { generateReport } from "./generateReport.js";

const filepath = generateReport();
console.log(`Report written to ${filepath}`);
FILEEOF

cat > frontend/scripts/scheduler/runScheduler.js << 'FILEEOF'
// The always-on process: polls each configured symbol on an interval,
// runs every configured strategy from the existing signalEngine.js
// against fresh candles, opens a virtual (paper) trade for every BUY/SELL
// it hasn't already got an open position on, checks existing open trades
// against the latest price, and fires the HTML report once a day.
//
// Run with:
//   npx vite-node -c vite.config.js scripts/scheduler/runScheduler.js
// (vite-node so this can import signalEngine.js's @alias paths exactly
// like the browser app does, with zero duplication of logic.)
//
// This process needs to keep running to do anything - it is NOT a cron
// job by itself, it schedules its own report internally via node-cron.
// See the README note on keeping this alive while your laptop is closed.

import cron from "node-cron";
import { generateSignal, STRATEGIES } from "@signals/signalEngine.js";
import { config } from "./config.js";
import { fetchCandles } from "./candles.js";
import { shouldOpen, checkExit } from "./virtualTrades.js";
import * as db from "./db.js";
import { generateReport } from "./generateReport.js";

const strategyIds = config.strategies.length ? config.strategies : Object.keys(STRATEGIES);

async function scanSymbol({ symbol, assetClass }) {
    let candles;
    try {
        candles = await fetchCandles({ symbol, assetClass, timeframe: config.timeframe, limit: config.candleLimit });
    } catch (err) {
        console.error(`[${symbol}] candle fetch failed: ${err.message}`);
        return;
    }
    if (!candles.length) return;

    const latestPrice = candles.at(-1).close;

    // 1. Resolve open virtual trades against the freshest price first, so a
    //    trade that would exit this cycle doesn't also get double-counted
    //    if a fresh signal reopens on the same symbol/strategy below.
    for (const strategyId of strategyIds) {
        for (const trade of db.getOpenSignals(symbol, strategyId)) {
            db.incrementCandlesSinceOpen(trade.id);
            const candlesSinceOpen = trade.candles_since_open + 1;

            const result = checkExit(
                { type: trade.type, stopLoss: trade.stop_loss, takeProfit: trade.take_profit, entryPrice: trade.entry_price },
                latestPrice,
                candlesSinceOpen,
                config.maxHoldCandles
            );

            if (result) {
                db.closeSignal(trade.id, {
                    closedAt: new Date().toISOString(),
                    exitPrice: result.exitPrice,
                    outcome: result.outcome,
                    closeReason: result.closeReason,
                    pnlPct: result.pnlPct
                });
                console.log(
                    `[${symbol}] closed ${trade.strategy_label} #${trade.id}: ${result.outcome} ` +
                    `(${result.pnlPct >= 0 ? "+" : ""}${result.pnlPct.toFixed(2)}%, ${result.closeReason})`
                );
            }
        }
    }

    // 2. Generate fresh signals. Skip a strategy/symbol pair that already
    //    has an open trade so we don't stack duplicate positions on top
    //    of each other every single cycle.
    for (const strategyId of strategyIds) {
        const signal = generateSignal(candles, strategyId);
        if (!shouldOpen(signal)) continue;
        if (db.getOpenSignals(symbol, strategyId).length > 0) continue;

        const id = db.insertSignal({
            createdAt: new Date().toISOString(),
            symbol,
            assetClass,
            timeframe: config.timeframe,
            strategyId,
            strategyLabel: signal.strategy,
            type: signal.type,
            confidence: signal.confidence ?? null,
            quality: signal.quality ?? null,
            entryPrice: signal.price ?? latestPrice,
            stopLoss: signal.risk?.stopLoss ?? null,
            takeProfit: signal.risk?.takeProfit ?? null,
            rewardMultiple: signal.risk?.rewardMultiple ?? null,
            regime: signal.regime?.primary ?? null,
            reason: signal.reason ?? ""
        });

        console.log(
            `[${symbol}] opened ${signal.strategy} #${id}: ${signal.type} @ ${signal.price} ` +
            `(confidence ${signal.confidence}, ${signal.quality})`
        );
    }
}

async function scanAll() {
    console.log(`\n--- scan ${new Date().toLocaleString()} ---`);
    for (const target of config.symbols) {
        await scanSymbol(target);
    }
}

async function main() {
    console.log(
        `Scheduler starting. Symbols: ${config.symbols.map(s => s.symbol).join(", ")}. ` +
        `Strategies: ${strategyIds.length}. Poll every ${config.pollIntervalMs / 1000}s.`
    );

    await scanAll();
    setInterval(scanAll, config.pollIntervalMs);

    const cronExpr = `${config.dailyReportMinute} ${config.dailyReportHour} * * *`;
    cron.schedule(cronExpr, () => {
        console.log("Generating daily report...");
        try {
            const filepath = generateReport();
            console.log(`Report written to ${filepath}`);
        } catch (err) {
            console.error("Report generation failed:", err.message);
        }
    });

    console.log(
        `Daily report scheduled for ${String(config.dailyReportHour).padStart(2, "0")}:` +
        `${String(config.dailyReportMinute).padStart(2, "0")} local time. Leave this process running.`
    );
}

main().catch(err => {
    console.error("Scheduler crashed:", err);
    process.exit(1);
});
FILEEOF

echo "Wiring up frontend/package.json (deps + scripts)..."
python3 - << 'PYEOF'
import json
from pathlib import Path

p = Path("frontend/package.json")
data = json.loads(p.read_text())

data.setdefault("dependencies", {})
data.setdefault("devDependencies", {})

deps_to_add = {
    "better-sqlite3": "^11.3.0",
    "node-cron": "^3.0.3",
    "ccxt": "^4.5.58",
}
for name, version in deps_to_add.items():
    assert name not in data["dependencies"], f"{name} already in dependencies, skipping to avoid clobbering"
    data["dependencies"][name] = version

dev_deps_to_add = {
    "vite": "^6.0.0",
    "vite-node": "^2.1.0",
}
for name, version in dev_deps_to_add.items():
    data["devDependencies"][name] = version

data.setdefault("scripts", {})
assert "scheduler" not in data["scripts"], "scripts.scheduler already exists"
assert "report" not in data["scripts"], "scripts.report already exists"
data["scripts"]["scheduler"] = "vite-node -c vite.config.js scripts/scheduler/runScheduler.js"
data["scripts"]["report"] = "vite-node -c vite.config.js scripts/scheduler/cli-report.js"

p.write_text(json.dumps(data, indent=2) + "\n")
print("frontend/package.json updated.")
PYEOF

GITIGNORE="frontend/.gitignore"
touch "$GITIGNORE"
grep -qxF "scripts/scheduler-data" "$GITIGNORE" 2>/dev/null || true
grep -qxF "data/" "$GITIGNORE" || echo "data/" >> "$GITIGNORE"
grep -qxF "reports/" "$GITIGNORE" || echo "reports/" >> "$GITIGNORE"

echo ""
echo "Installing new dependencies (this runs node-gyp for better-sqlite3 -"
echo "if it fails, you likely need Xcode Command Line Tools: xcode-select --install)"
( cd frontend && npm install )

echo ""
echo "Done. Next steps:"
echo "  1. Start the scheduler:   cd frontend && npm run scheduler"
echo "     (leave this running - it scans on its own interval and writes"
echo "     a report to frontend/reports/ at the hour set in"
echo "     scripts/scheduler/config.js, default 18:00)"
echo "  2. Generate a report on demand any time: cd frontend && npm run report"
echo "  3. Signals persist in frontend/data/signals.db (SQLite) - safe to"
echo "     open with any SQLite browser if you want to query it directly."
echo ""
echo "Edit frontend/scripts/scheduler/config.js to change symbols,"
echo "poll interval, or the report time."
