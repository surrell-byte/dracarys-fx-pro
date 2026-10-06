#!/usr/bin/env node

import { fetchCandles } from "../scheduler/candles.js";
import { runBacktest } from "../../src/js/analysis/backtestEngine.js";
import { runSweep } from "../../src/js/analysis/sweepRunner.js";
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
    const combinations = [];

    for (const atr of atrList) {
        for (const reward of rewardList) {
            const configuration = {
                strategyId: args.strategy,
                atr,
                reward,
                payoutRatio: reward,
                assetClass: args.assetClass,
                costs: DEFAULT_EXECUTION_COSTS[args.assetClass] ?? null,
                maxHoldCandles: 60,
                ambiguousFillRule: "conservative"
            };
            if (args.adx != null) configuration.adx = args.adx;
            if (args.volumeRatio != null) configuration.volumeRatio = args.volumeRatio;
            if (args.lookback != null) configuration.lookback = args.lookback;
            combinations.push(configuration);
        }
    }

    const results = await runSweep({
        candles,
        combinations,
        executor: runBacktest,
        baseOptions: {
            strategyIds: [args.strategy],
            assetClass: args.assetClass,
            costs: DEFAULT_EXECUTION_COSTS[args.assetClass] ?? null,
            maxHoldCandles: 60,
            ambiguousFillRule: "conservative"
        }
    });

    const persistedResults = results.map((entry) => ({
        atr: entry.config?.atr ?? null,
        reward: entry.config?.reward ?? null,
        trades: entry.metrics?.trades ?? 0,
        expectancy: entry.metrics?.expectancy ?? null,
        profitFactor: entry.metrics?.profitFactor ?? null,
        sharpe: entry.metrics?.sharpe ?? null,
        status: entry.status,
        error: entry.error ?? null
    }));

    for (const entry of results) {
        const row = entry.metrics;
        console.log(`atr=${entry.config?.atr}, reward=${entry.config?.reward} -> status=${entry.status}, trades=${row?.trades ?? 0}, expectancy=${pct(row?.expectancy)}, pf=${row?.profitFactor ?? 'n/a'}`);
    }

    // include scoring overrides in filename to avoid overwriting different runs
    const suffixParts = [];
    if (args.adx != null) suffixParts.push(`adx${args.adx}`);
    if (args.volumeRatio != null) suffixParts.push(`vol${args.volumeRatio}`);
    if (args.lookback != null) suffixParts.push(`lk${args.lookback}`);
    const suffix = suffixParts.length ? `-${suffixParts.join('-')}` : '';
    const outPath = path.resolve(`reports/analysis/parameter-sweep-${args.strategy}-${args.symbol.replace('/', '-')}-${args.timeframe}${suffix}.json`);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(persistedResults, null, 2), "utf8");
    console.log(`Saved sweep results to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
