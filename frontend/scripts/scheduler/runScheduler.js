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
import * as db from "./db.js";
import { generateReport } from "./generateReport.js";
import { sendDiscordMessage, meetsNotifyThreshold, formatSignalMessage, formatDailySummaryMessage } from "./notify.js";

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

    console.log(
        `Daily report scheduled for ${String(config.dailyReportHour).padStart(2, "0")}:` +
        `${String(config.dailyReportMinute).padStart(2, "0")} local time. Leave this process running.`
    );
}

main().catch(err => {
    console.error("Scheduler crashed:", err);
    process.exit(1);
});
