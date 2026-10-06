#!/usr/bin/env node

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { runBacktest } from "../../src/js/analysis/backtestEngine.js";
import { STRATEGIES } from "../../src/js/signals/signalEngine.js";
import { breakevenWinRate } from "../../src/js/analysis/payoutMetrics.js";

const WS_BASE_URL = "wss://ws.derivws.com/websockets/v3";
const DEFAULT_APP_ID = "1089";
const GRANULARITY = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const SYMBOLS = {
    "EUR/USD": "frxEURUSD", "GBP/USD": "frxGBPUSD", "USD/JPY": "frxUSDJPY",
    "USD/CHF": "frxUSDCHF", "AUD/USD": "frxAUDUSD", "USD/CAD": "frxUSDCAD",
    "NZD/USD": "frxNZDUSD", "EUR/JPY": "frxEURJPY", "GBP/JPY": "frxGBPJPY"
};

function parseArgs(argv) {
    const args = {
        symbol: "EUR/USD", timeframe: "5m", strategy: "balanced", limit: 5000,
        folds: 5, warmup: 320, payout: 0.85, expiries: "1,3,5,10,15",
        confidences: "0,60,65,70", output: null
    };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        if (key === "--symbol") args.symbol = argv[++i];
        if (key === "--timeframe") args.timeframe = argv[++i];
        if (key === "--strategy") args.strategy = argv[++i];
        if (key === "--limit") args.limit = Number(argv[++i]);
        if (key === "--folds") args.folds = Number(argv[++i]);
        if (key === "--warmup") args.warmup = Number(argv[++i]);
        if (key === "--payout") args.payout = Number(argv[++i]);
        if (key === "--expiries") args.expiries = argv[++i];
        if (key === "--confidences") args.confidences = argv[++i];
        if (key === "--output") args.output = argv[++i];
    }
    if (!SYMBOLS[args.symbol]) throw new Error(`Unsupported Deriv FX symbol: ${args.symbol}`);
    if (!GRANULARITY[args.timeframe]) throw new Error(`Unsupported timeframe: ${args.timeframe}`);
    if (!STRATEGIES[args.strategy]) throw new Error(`Unknown strategy: ${args.strategy}`);
    if (!Number.isInteger(args.limit) || args.limit < args.warmup + args.folds * 20) throw new Error("--limit is too small for warmup and folds");
    if (!Number.isInteger(args.folds) || args.folds < 3) throw new Error("--folds must be an integer >= 3");
    return args;
}

async function fetchDerivCandles({ symbol, timeframe, limit, appId }) {
    const response = await requestDeriv({
        ticks_history: SYMBOLS[symbol], end: "latest", count: Math.min(limit + 1, 5000),
        style: "candles", granularity: GRANULARITY[timeframe]
    }, appId);
    const candles = (response.candles ?? []).map(candle => ({
        time: Number(candle.epoch) * 1000, open: Number(candle.open), high: Number(candle.high),
        low: Number(candle.low), close: Number(candle.close), volume: null
    })).filter(candle => [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
    // The last Deriv candle is active. It must never enter historical scoring.
    return candles.slice(0, -1);
}

function requestDeriv(payload, appId) {
    const WebSocketImpl = WebSocket;
    return new Promise((resolve, reject) => {
        const ws = new WebSocketImpl(`${WS_BASE_URL}?app_id=${encodeURIComponent(appId)}`);
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("Deriv request timed out"));
        }, 15000);
        ws.addEventListener("open", () => ws.send(JSON.stringify({ ...payload, req_id: 1 })));
        ws.addEventListener("message", event => {
            const message = JSON.parse(event.data);
            if (message.error) {
                clearTimeout(timeout);
                ws.close();
                reject(new Error(message.error.message));
            } else if (message.msg_type === "candles") {
                clearTimeout(timeout);
                ws.close();
                resolve(message);
            }
        });
        ws.addEventListener("error", () => {
            clearTimeout(timeout);
            reject(new Error("Deriv connection failed"));
        });
    });
}

function scoreRows(rows, payout) {
    const trades = rows.reduce((sum, row) => sum + row.trades, 0);
    const wins = rows.reduce((sum, row) => sum + Math.round(row.winRate * row.trades / 100), 0);
    const ev = trades ? (wins * payout - (trades - wins)) / trades : null;
    return {
        trades, wins, losses: trades - wins,
        winRate: trades ? wins / trades : null,
        expectancy: ev,
        edge: ev === null ? null : ev,
        foldsPositive: rows.filter(row => row.expectancy > 0).length,
        folds: rows.length
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const appId = process.env.VITE_DERIV_APP_ID || DEFAULT_APP_ID;
    const candles = await fetchDerivCandles({ ...args, appId });
    const expiryLengths = args.expiries.split(",").map(Number).filter(Number.isInteger);
    const confidences = args.confidences.split(",").map(Number).filter(Number.isFinite);
    const scored = candles.length - args.warmup;
    const foldSize = Math.floor(scored / args.folds);
    const results = [];

    for (const expiryLength of expiryLengths) {
        for (const minConfidence of confidences) {
            const foldRows = [];
            for (let fold = 0; fold < args.folds; fold += 1) {
                const scoreStart = args.warmup + fold * foldSize;
                const end = fold === args.folds - 1 ? candles.length : args.warmup + (fold + 1) * foldSize;
                const contextStart = Math.max(0, scoreStart - args.warmup);
                const result = await runBacktest(candles.slice(contextStart, end), {
                    strategyIds: [args.strategy],
                    payoutRatio: args.payout,
                    expiryLengths: [expiryLength],
                    assetClass: "forex",
                    scoreStartIndex: scoreStart - contextStart,
                    entryFilters: { enabled: minConfidence > 0, minConfidence }
                });
                const row = result.binaryStats[0];
                foldRows.push({
                    fold: fold + 1,
                    trades: row?.trades ?? 0,
                    winRate: row?.winRate ?? 0,
                    expectancy: row?.winRate == null ? null : (row.winRate / 100) * args.payout - (1 - row.winRate / 100)
                });
            }
            const summary = scoreRows(foldRows, args.payout);
            results.push({ expiryLength, minConfidence, ...summary, foldResults: foldRows });
        }
    }

    results.sort((a, b) => (b.edge ?? -Infinity) - (a.edge ?? -Infinity));
    const report = {
        generatedAt: new Date().toISOString(), source: "Deriv official public candles",
        symbol: args.symbol, timeframe: args.timeframe, strategy: args.strategy,
        payout: args.payout, breakevenWinRate: breakevenWinRate(args.payout),
        candles: candles.length, warmup: args.warmup, folds: args.folds,
        note: "All candles are closed before scoring. Results are research only; Deriv proposal quotes and contract settlement are not simulated.",
        results
    };
    const output = path.resolve(args.output ?? `reports/analysis/deriv-binary-${args.symbol.replaceAll("/", "-")}-${args.timeframe}-${args.strategy}.json`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2), "utf8");
    console.table(results.map(({ expiryLength, minConfidence, trades, winRate, expectancy, foldsPositive, folds }) => ({ expiryLength, minConfidence, trades, winRate: winRate == null ? null : `${(winRate * 100).toFixed(2)}%`, expectancy: expectancy == null ? null : expectancy.toFixed(4), foldsPositive: `${foldsPositive}/${folds}` })));
    console.log(`Saved ${output}`);
}

main().catch(error => {
    console.error(`Deriv binary walk-forward failed: ${error.message}`);
    process.exitCode = 1;
});
