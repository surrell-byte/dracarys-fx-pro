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

import "dotenv/config";
import cron from "node-cron";
import { generateSignal, STRATEGIES } from "@signals/signalEngine.js";
import { config } from "./config.js";
import { fetchCandles } from "./candles.js";
import { shouldOpen, checkExit } from "./virtualTrades.js";
import { evaluatePortfolioRisk } from "./portfolioRisk.js";
import * as db from "./db.js";
import { generateReport } from "./generateReport.js";
import { sendDiscordMessage, meetsNotifyThreshold, formatSignalMessage, formatDailySummaryMessage } from "./notify.js";

const strategyIds = config.strategies.length ? config.strategies : Object.keys(STRATEGIES);

const TIMEFRAME_MS = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "1d": 86_400_000 };

// Heuristic: a candle is "still forming" if its start time plus one full
// timeframe duration hasn't passed yet. This isn't perfect (exchange clocks
// can differ slightly from ours), but it's a reasonable guard against
// trading off a bar that hasn't closed.
function isLikelyStillForming(candle, timeframe) {
    const durationMs = TIMEFRAME_MS[timeframe] ?? 60_000;
    return Date.now() < candle.time + durationMs;
}

async function scanSymbol({ symbol, assetClass }) {
    let candles;
    try {
        candles = await fetchCandles({ symbol, assetClass, timeframe: config.timeframe, limit: config.candleLimit });
    } catch (err) {
        console.error(`[${symbol}] candle fetch failed: ${err.message}`);
        return;
    }
    if (!candles.length) return;

    // Exchanges commonly include the still-forming candle as the last
    // element of an OHLCV response. Trading off that candle's close (or
    // treating a poll cycle as if it were a closed candle) makes the
    // scheduler see different, incomplete data than the browser UI - which
    // only ever reacts to fully-closed candles. Drop the in-progress bar
    // here so both surfaces evaluate the same closed-candle history.
    const closedCandles = isLikelyStillForming(candles.at(-1), config.timeframe)
        ? candles.slice(0, -1)
        : candles;
    if (!closedCandles.length) return;

    const latestCandle = closedCandles.at(-1);
    const latestPrice = latestCandle.close;

    // 1. Resolve open virtual trades against the freshest closed candle
    //    first, so a trade that would exit this cycle doesn't also get
    //    double-counted if a fresh signal reopens on the same
    //    symbol/strategy below.
    for (const strategyId of strategyIds) {
        for (const trade of db.getOpenSignals(symbol, strategyId)) {
            // Only advance the hold counter when a genuinely new closed
            // candle has appeared since we last looked at this trade -
            // otherwise, on timeframes polled more often than once per
            // candle (e.g. 1m candles polled every 5m for forex), this
            // counter silently becomes "polls since open" instead of
            // "candles since open", and maxHoldCandles ends up meaning
            // something different per asset class.
            const isNewCandle = trade.last_candle_time == null || latestCandle.time > trade.last_candle_time;
            if (isNewCandle) {
                db.incrementCandlesSinceOpen(trade.id, latestCandle.time);
            }
            const candlesSinceOpen = isNewCandle ? trade.candles_since_open + 1 : trade.candles_since_open;

            const result = checkExit(
                { type: trade.type, stopLoss: trade.stop_loss, takeProfit: trade.take_profit, entryPrice: trade.entry_price },
                latestCandle,
                candlesSinceOpen,
                config.maxHoldCandles,
                config.ambiguousFillRule
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
        const signal = generateSignal(closedCandles, strategyId);
        if (!shouldOpen(signal)) continue;
        if (db.getOpenSignals(symbol, strategyId).length > 0) continue;

        // Portfolio-level gate: even though this symbol/strategy pair is
        // free to open, check it against exposure limits across ALL open
        // trades first. Without this, independent strategies agreeing on
        // the same directional thesis could stack dozens of positions
        // that are really one bet repeated, not independent confirmations.
        const riskCheck = evaluatePortfolioRisk(
            { symbol, type: signal.type },
            db.getAllOpenSignals(),
            db.getTodaysClosedSignals(),
            config.portfolioRiskLimits
        );
        if (!riskCheck.allowed) {
            console.log(`[${symbol}] skipped ${signal.strategy} ${signal.type}: ${riskCheck.reasons.join("; ")}`);
            continue;
        }

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
            reason: signal.reason ?? "",
            expiryLabel: signal.expiry?.label ?? null,
            expiryMinutes: signal.expiry?.minutes ?? null
        });

        console.log(
            `[${symbol}] opened ${signal.strategy} #${id}: ${signal.type} @ ${signal.price} ` +
            `(confidence ${signal.confidence}, ${signal.quality})`
        );

        if (meetsNotifyThreshold(signal, config.notifications)) {
            sendDiscordMessage(formatSignalMessage(signal, symbol));
        }
    }
}

const lastPolled = new Map();

function isDue(target, now) {
    const interval = target.pollIntervalMs ?? config.pollIntervalMs;
    const last = lastPolled.get(target.symbol) ?? 0;
    return now - last >= interval;
}

async function scanAll() {
    console.log(`\n--- scan ${new Date().toLocaleString()} ---`);
    const now = Date.now();
    for (const target of config.symbols) {
        if (!isDue(target, now)) continue;
        lastPolled.set(target.symbol, now);
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
                sendDiscordMessage(formatDailySummaryMessage(data));
            }
        } catch (err) {
            console.error("Report generation failed:", err.message);
        }
    });

    cron.schedule(`${config.dailyReportMinute} ${config.dailyReportHour} * * ${config.weeklyReportDay}`, () => {
        console.log("Generating weekly report...");
        try {
            const { filepath } = generateReport({ period: "weekly" });
            console.log(`Weekly report written to ${filepath}`);
        } catch (err) {
            console.error("Weekly report generation failed:", err.message);
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
