#!/usr/bin/env bash
# apply-scheduler-phase2-notifications.sh
#
# Adds Telegram push notifications to the Phase 1 scheduler:
#   - pings you for any signal meeting a confidence/quality threshold
#     (default: 75+ confidence AND Medium+ quality)
#   - pings you a short summary when the daily report generates
#   - safe if Telegram isn't configured yet: logs one warning and
#     otherwise runs exactly as before
#
# Requires Phase 1 (apply-scheduler-phase1.sh) already applied.
#
# Run from your project root:
#   chmod +x apply-scheduler-phase2-notifications.sh
#   ./apply-scheduler-phase2-notifications.sh
#
# One-time Telegram setup (do this before running the scheduler):
#   1. Message @BotFather on Telegram -> /newbot -> follow the prompts.
#      You'll get a token like 123456789:AAExxxxxxxxxxx
#   2. Send your new bot any message (e.g. "hi"), then visit in a browser:
#        https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
#      Find "chat":{"id": ...} in the JSON - that's your chat id.
#   3. Add both to frontend/.env (this script adds the placeholder lines
#      to frontend/.env.example - copy frontend/.env.example to
#      frontend/.env if you haven't already, and fill in real values).

set -euo pipefail

if [ ! -f "frontend/scripts/scheduler/runScheduler.js" ]; then
    echo "Phase 1 scheduler not found. Run apply-scheduler-phase1.sh first." >&2
    exit 1
fi

echo "Writing notify.js and updated scheduler files..."

cat > frontend/scripts/scheduler/notify.js << 'FILEEOF'
// Telegram push notifications for high-confidence signals + the daily
// report summary. Isolated here so a notification failure (bad token,
// network hiccup, Telegram down) never takes down the scheduler - every
// send is wrapped and just logs a warning on failure.
//
// Setup (one-time):
//   1. Message @BotFather on Telegram, send /newbot, follow the prompts.
//      You'll get back a token that looks like 123456789:AAExxxxxxxxxxx
//   2. Message your new bot anything (e.g. "hi") so it's allowed to reply
//      to you, then visit:
//        https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
//      and find "chat":{"id": ...} in the response - that number is your
//      chat id.
//   3. Put both in frontend/.env:
//        TELEGRAM_BOT_TOKEN=123456789:AAExxxxxxxxxxx
//        TELEGRAM_CHAT_ID=987654321

let warnedMissingConfig = false;

export async function sendTelegramMessage(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        if (!warnedMissingConfig) {
            console.warn(
                "Telegram notifications are enabled in config.js but " +
                "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set in frontend/.env " +
                "- skipping notifications (see notify.js header for setup steps)."
            );
            warnedMissingConfig = true;
        }
        return false;
    }

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
        });
        if (!res.ok) {
            const body = await res.text();
            console.warn(`Telegram send failed (${res.status}): ${body}`);
            return false;
        }
        return true;
    } catch (err) {
        console.warn("Telegram send failed:", err.message);
        return false;
    }
}

const QUALITY_RANK = { Low: 0, Medium: 1, High: 2 };

export function meetsNotifyThreshold(signal, notifyConfig) {
    if (!notifyConfig?.enabled) return false;
    const confidenceOk = (signal.confidence ?? 0) >= (notifyConfig.minConfidence ?? 0);
    const qualityOk = (QUALITY_RANK[signal.quality] ?? 0) >= (QUALITY_RANK[notifyConfig.minQuality] ?? 0);
    return confidenceOk && qualityOk;
}

export function formatSignalMessage(signal, symbol) {
    const emoji = signal.type === "BUY" ? "🟢" : "🔴";
    const rr = signal.risk?.rrLabel ? `\nR:R  ${signal.risk.rrLabel}` : "";
    const sl = signal.risk?.stopLoss ? `\nStop  ${round(signal.risk.stopLoss)}` : "";
    const tp = signal.risk?.takeProfit ? `\nTarget  ${round(signal.risk.takeProfit)}` : "";

    return (
        `${emoji} *${signal.type} ${symbol}*\n` +
        `Strategy: ${signal.strategy}\n` +
        `Confidence: ${signal.confidence} (${signal.quality})\n` +
        `Entry  ${round(signal.price)}${sl}${tp}${rr}\n\n` +
        `${signal.reason}\n\n` +
        `_Added to the log — no action needed, review at your own pace._`
    );
}

export function formatDailySummaryMessage(data) {
    const pf = data.profitFactor === Infinity ? "∞" : data.profitFactor.toFixed(2);
    const best = data.bestStrategy ? `${data.bestStrategy.key} (${data.bestStrategy.winRate.toFixed(0)}%)` : "—";
    const worst = data.worstStrategy ? `${data.worstStrategy.key} (${data.worstStrategy.winRate.toFixed(0)}%)` : "—";

    return (
        `📊 *Daily Report — ${data.dateLabel}*\n\n` +
        `Trades: ${data.totalTrades}  |  Win rate: ${data.winRate.toFixed(1)}%\n` +
        `Total P/L: ${data.totalPnlPct >= 0 ? "+" : ""}${data.totalPnlPct.toFixed(2)}%  |  Profit factor: ${pf}\n` +
        `Best: ${best}\n` +
        `Worst: ${worst}\n` +
        `Still open: ${data.openCount}\n\n` +
        `Full report saved locally with per-trade reasoning.`
    );
}

function round(n) {
    return Number.isFinite(n) ? Number(n.toFixed(4)) : n;
}
FILEEOF

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

    // Telegram push notifications - see notify.js header for one-time bot
    // setup steps. Needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in
    // frontend/.env; scheduler runs fine without them, it just skips
    // sending and logs a warning once.
    notifications: {
        enabled: true,
        // Only signals meeting BOTH thresholds get pushed - everything
        // still gets logged to SQLite and shows up in the daily report
        // regardless of this setting.
        minConfidence: 75,
        minQuality: "Medium", // "Low" | "Medium" | "High"
        // Also push a short daily summary when the HTML report generates.
        dailySummary: true
    },

    dbPath: new URL("../../data/signals.db", import.meta.url).pathname,
    reportsDir: new URL("../../reports", import.meta.url).pathname
};
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

    // Returning `data` alongside the filepath lets callers (like the
    // scheduler's Telegram summary) reuse the same aggregated numbers
    // instead of re-querying the DB right after this just did.
    return { filepath, data };
}
FILEEOF

cat > frontend/scripts/scheduler/cli-report.js << 'FILEEOF'
// One-off manual report generation, for testing or generating a report
// on demand outside the daily cron schedule.
//   npx vite-node -c vite.config.js scripts/scheduler/cli-report.js
import { generateReport } from "./generateReport.js";

const { filepath } = generateReport();
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
import { sendTelegramMessage, meetsNotifyThreshold, formatSignalMessage, formatDailySummaryMessage } from "./notify.js";

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

        if (meetsNotifyThreshold(signal, config.notifications)) {
            sendTelegramMessage(formatSignalMessage(signal, symbol));
        }
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
            const { filepath, data } = generateReport();
            console.log(`Report written to ${filepath}`);
            if (config.notifications?.enabled && config.notifications?.dailySummary) {
                sendTelegramMessage(formatDailySummaryMessage(data));
            }
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

ENV_EXAMPLE="frontend/.env.example"
touch "$ENV_EXAMPLE"
if ! grep -q "TELEGRAM_BOT_TOKEN" "$ENV_EXAMPLE"; then
    cat >> "$ENV_EXAMPLE" << 'ENVEOF'

# Telegram push notifications for the scheduler - see notify.js header for
# setup steps (message @BotFather to create a bot, then getUpdates to find
# your chat id). Copy this file to frontend/.env and fill in real values.
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
ENVEOF
    echo "Added Telegram placeholders to frontend/.env.example"
else
    echo "frontend/.env.example already has Telegram placeholders, leaving it alone."
fi

echo ""
echo "Done. No new npm packages needed (uses the built-in fetch)."
echo ""
echo "Before starting the scheduler:"
echo "  1. Follow the Telegram setup steps at the top of this script."
echo "  2. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to frontend/.env"
echo "     (copy from frontend/.env.example if you don't have a .env yet)."
echo "  3. Tune thresholds in frontend/scripts/scheduler/config.js under"
echo "     'notifications' if 75/Medium is too chatty or too quiet."
echo ""
echo "Then: cd frontend && npm run scheduler"
echo "If Telegram isn't configured yet, it'll just log one warning and"
echo "keep scanning/logging/reporting exactly like Phase 1 did."
