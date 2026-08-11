#!/usr/bin/env node
// scripts/analysis/multiMarketWalkForward.js
//
// Orchestration layer over the existing runWalkForwardBacktest(): loops it
// across every market/timeframe combination and writes one consolidated
// JSON report. Does not reimplement any backtest logic.
//
// Usage:
//   node scripts/analysis/multiMarketWalkForward.js
//   node scripts/analysis/multiMarketWalkForward.js --limit 1000 --folds 3
//   node scripts/analysis/multiMarketWalkForward.js --output reports/analysis/custom.json
//
// Start small (--limit 1000 --folds 3) to confirm the machinery works
// before running the full default sweep.

import fs from "node:fs/promises";
import path from "node:path";

import { fetchCandles } from "../scheduler/candles.js";
import { runWalkForwardBacktest } from "../../src/js/analysis/backtestEngine.js";
import { STRATEGIES } from "../../src/js/signals/signalEngine.js";
import { config } from "../scheduler/config.js";

const MARKETS = [
    { symbol: "BTC/USDT", assetClass: "crypto" },
    { symbol: "ETH/USDT", assetClass: "crypto" },
    { symbol: "EUR/USD", assetClass: "forex" },
    { symbol: "GBP/USD", assetClass: "forex" }
];

const TIMEFRAMES = ["1m", "5m", "15m"];

function parseArgs(argv) {
    const args = { limit: 5000, folds: 5, output: "reports/analysis/multi-market-walk-forward.json" };

    for (let i = 0; i < argv.length; i += 1) {
        switch (argv[i]) {
            case "--limit":
                args.limit = Number(argv[++i]);
                break;
            case "--folds":
                args.folds = Number(argv[++i]);
                break;
            case "--output":
                args.output = argv[++i];
                break;
            default:
                break;
        }
    }

    return args;
}

function summariseFoldResults(results, symbol, timeframe) {
    const rows = [];

    for (const fold of results.folds) {
        for (const row of fold.spotLeaderboard ?? []) {
            rows.push({
                symbol,
                timeframe,
                fold: fold.fold,
                strategy: row.strategy,
                trades: row.trades ?? 0,
                winRate: row.winRate ?? null,
                totalPnl: row.totalPnl ?? null,
                expectancy: row.expectancy ?? null,
                profitFactor: row.profitFactor ?? null,
                sharpe: row.sharpe ?? null
            });
        }
    }

    return rows;
}

async function runMarket({ symbol, assetClass, timeframe, limit, folds }) {
    console.log(`\nFetching ${limit} ${timeframe} candles for ${symbol}...`);

    const candles = await fetchCandles({ symbol, assetClass, timeframe, limit });

    if (candles.length < folds * 2) {
        throw new Error(`${symbol} ${timeframe}: only ${candles.length} candles available`);
    }

    console.log(`Running ${folds}-fold walk-forward for ${symbol} ${timeframe}...`);

    const result = await runWalkForwardBacktest(candles, {
        folds,
        strategyIds: Object.keys(STRATEGIES),
        assetClass,
        costs: config.executionCosts?.[assetClass] ?? null
    });

    return {
        symbol,
        assetClass,
        timeframe,
        candleCount: candles.length,
        foldCount: result.folds.length,
        folds: result.folds,
        rows: summariseFoldResults(result, symbol, timeframe)
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const results = [];

    for (const market of MARKETS) {
        for (const timeframe of TIMEFRAMES) {
            try {
                const result = await runMarket({ ...market, timeframe, limit: args.limit, folds: args.folds });
                results.push(result);
            } catch (error) {
                console.error(`❌ ${market.symbol} ${timeframe}: ${error.message}`);
                results.push({ symbol: market.symbol, assetClass: market.assetClass, timeframe, error: error.message });
            }
        }
    }

    const outputPath = path.resolve(args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    await fs.writeFile(
        outputPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                configuration: { markets: MARKETS, timeframes: TIMEFRAMES, limit: args.limit, folds: args.folds },
                results
            },
            null,
            2
        )
    );

    console.log(`\n✅ Saved: ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
