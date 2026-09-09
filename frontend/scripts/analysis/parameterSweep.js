#!/usr/bin/env node

import { fetchCandles } from "../scheduler/candles.js";
import { runBacktest } from "../../src/js/analysis/backtestEngine.js";
import path from "node:path";
import fs from "node:fs/promises";
import { DEFAULT_EXECUTION_COSTS } from "../../src/js/analysis/executionCosts.js";

function parseArgs(argv) {
    const args = { strategy: null, symbol: "BTC/USDT", assetClass: "crypto", timeframe: "5m", limit: 2000, atrs: "1.2,1.5,1.8", rewards: "1.5,2.5,4.0", adx: null, volumeRatio: null, lookback: null };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--strategy") args.strategy = argv[++i];
        if (argv[i] === "--symbol") args.symbol = argv[++i];
        if (argv[i] === "--assetClass") args.assetClass = argv[++i];
        if (argv[i] === "--timeframe") args.timeframe = argv[++i];
        if (argv[i] === "--limit") args.limit = Number(argv[++i]);
        if (argv[i] === "--atrs") args.atrs = argv[++i];
        if (argv[i] === "--rewards") args.rewards = argv[++i];
        if (argv[i] === "--adx") args.adx = Number(argv[++i]);
        if (argv[i] === "--volumeRatio") args.volumeRatio = Number(argv[++i]);
        if (argv[i] === "--lookback") args.lookback = Number(argv[++i]);
    }
    return args;
}

function pct(n, digits = 3) { return n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`; }

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.strategy) { console.error("Pass --strategy <id>"); process.exit(1); }

    console.log(`Fetching ${args.limit} ${args.timeframe} candles for ${args.symbol} (${args.assetClass})...`);
    const candles = await fetchCandles({ symbol: args.symbol, timeframe: args.timeframe, limit: args.limit, assetClass: args.assetClass });
    console.log(`Got ${candles.length} candles. Running parameter sweep for ${args.strategy}...`);

    const atrList = args.atrs.split(",").map(Number);
    const rewardList = args.rewards.split(",").map(Number);

    const results = [];
    for (const atr of atrList) {
        for (const reward of rewardList) {
            // Patch strategy defaults by passing `strategyOverrides` into runBacktest's options
            const strategyOverrides = { atrStopMultiplier: atr, rewardMultiple: reward };
            if (args.adx != null) strategyOverrides.adx = args.adx;
            if (args.volumeRatio != null) strategyOverrides.volumeRatio = args.volumeRatio;
            if (args.lookback != null) strategyOverrides.lookback = args.lookback;

            const result = await runBacktest(candles, {
                strategyIds: [args.strategy],
                payoutRatio: reward,
                extraSignalContext: {
                    strategyRiskOverridesByStrategy: { [args.strategy]: strategyOverrides }
                },
                assetClass: args.assetClass,
                costs: DEFAULT_EXECUTION_COSTS[args.assetClass] ?? null,
                maxHoldCandles: 60,
                ambiguousFillRule: "conservative"
            });
            const row = result.spotLeaderboard.find((r) => r.strategy === args.strategy) || {};
            results.push({ atr, reward, trades: row.trades, expectancy: row.expectancy, profitFactor: row.profitFactor, sharpe: row.sharpe });
            console.log(`atr=${atr}, reward=${reward} -> trades=${row.trades}, expectancy=${pct(row.expectancy)}, pf=${row.profitFactor ?? 'n/a'}`);
        }
    }

    // include scoring overrides in filename to avoid overwriting different runs
    const suffixParts = [];
    if (args.adx != null) suffixParts.push(`adx${args.adx}`);
    if (args.volumeRatio != null) suffixParts.push(`vol${args.volumeRatio}`);
    if (args.lookback != null) suffixParts.push(`lk${args.lookback}`);
    const suffix = suffixParts.length ? `-${suffixParts.join('-')}` : '';
    const outPath = path.resolve(`reports/analysis/parameter-sweep-${args.strategy}-${args.symbol.replace('/', '-')}-${args.timeframe}${suffix}.json`);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`Saved sweep results to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
