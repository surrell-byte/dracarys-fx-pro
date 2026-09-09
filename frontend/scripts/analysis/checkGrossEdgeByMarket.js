#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
    flattenResearchTrades,
    bootstrapBlockMeanCI
} from "../../src/js/analysis/scorecard.js";

function parseArgs(argv) {
    const args = { input: "reports/analysis/multi-market-walk-forward.json", strategy: null, iterations: 2000 };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--input") args.input = argv[++i];
        if (argv[i] === "--strategy") args.strategy = argv[++i];
        if (argv[i] === "--iterations") args.iterations = Number(argv[++i]);
    }
    return args;
}

function pct(value, digits = 4) {
    return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%` : "n/a";
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.strategy) {
        console.error("Pass --strategy <id>");
        process.exit(1);
    }

    const raw = await fs.readFile(path.resolve(args.input), "utf8");
    const report = JSON.parse(raw);
    const allTrades = flattenResearchTrades(report);
    const strategyTrades = allTrades.filter((t) => t.strategy === args.strategy);
    if (!strategyTrades.length) {
        console.error(`No trades for strategy ${args.strategy}`);
        process.exit(1);
    }

    // Group by market (symbol)
    const byMarket = new Map();
    for (const t of strategyTrades) {
        const key = t.symbol || "UNKNOWN";
        if (!byMarket.has(key)) byMarket.set(key, []);
        byMarket.get(key).push(t);
    }

    console.log(`Per-market breakdown for strategy: ${args.strategy}\n`);

    for (const [market, trades] of byMarket.entries()) {
        const grossTrades = trades
            .filter((tr) => Number.isFinite(Number(tr.grossPnlPercent)))
            .map((tr) => ({ ...tr, pnlPercent: Number(tr.grossPnlPercent) }));
        const netTrades = trades.map((tr) => ({ ...tr, pnlPercent: Number(tr.pnlPercent) }));

        const grossMean = grossTrades.reduce((s, t) => s + t.pnlPercent, 0) / Math.max(1, grossTrades.length);
        const netMean = netTrades.reduce((s, t) => s + t.pnlPercent, 0) / Math.max(1, netTrades.length);

        const grossCI = grossTrades.length ? bootstrapBlockMeanCI(grossTrades, { iterations: args.iterations, seed: `gross-edge-by-market:${args.strategy}:${market}` }) : null;
        const netCI = netTrades.length ? bootstrapBlockMeanCI(netTrades, { iterations: args.iterations, seed: `net-edge-by-market:${args.strategy}:${market}` }) : null;

        console.log(`Market: ${market}`);
        console.log(`  Trades: ${trades.length}`);
        console.log(`  Gross expectancy: ${pct(grossMean)}`);
        if (grossCI) console.log(`    CI: ${pct(grossCI.lower)} → ${pct(grossCI.upper)}`);
        console.log(`  Net expectancy: ${pct(netMean)}`);
        if (netCI) console.log(`    CI: ${pct(netCI.lower)} → ${pct(netCI.upper)}`);
        console.log("");
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
