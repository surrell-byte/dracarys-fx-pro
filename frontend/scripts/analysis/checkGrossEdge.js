#!/usr/bin/env node

// Ad-hoc check: is a strategy's GROSS expectancy (before execution costs)
// distinguishable from zero, or just noise?
//
// Reuses the existing bootstrapBlockMeanCI (same deterministic PRNG,
// same symbol/timeframe/fold block structure) but feeds it grossPnlPercent
// instead of pnlPercent, so the CI reflects the raw signal, not the
// cost-adjusted outcome.
//
// Usage:
//   node scripts/analysis/checkGrossEdge.js --strategy range
//   node scripts/analysis/checkGrossEdge.js --strategy range --input reports/analysis/multi-market-walk-forward.json

import fs from "node:fs/promises";
import path from "node:path";

import {
    flattenResearchTrades,
    bootstrapBlockMeanCI
} from "../../src/js/analysis/scorecard.js";

function parseArgs(argv) {
    const args = {
        input: "reports/analysis/multi-market-walk-forward.json",
        strategy: null,
        iterations: 5000
    };

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
        console.error("Pass --strategy <id> (e.g. --strategy range)");
        process.exit(1);
    }

    const inputPath = path.resolve(args.input);
    const raw = await fs.readFile(inputPath, "utf8");
    const report = JSON.parse(raw);
    const allTrades = flattenResearchTrades(report);

    const strategyTrades = allTrades.filter((trade) => trade.strategy === args.strategy);

    if (!strategyTrades.length) {
        console.error(`No trades found for strategy "${args.strategy}". Available strategies:`);
        console.error([...new Set(allTrades.map((t) => t.strategy))].join(", "));
        process.exit(1);
    }

    // Swap in grossPnlPercent as the value the bootstrap resamples,
    // so the CI describes the pre-cost signal rather than net P&L.
    const grossTrades = strategyTrades
        .filter((trade) => Number.isFinite(Number(trade.grossPnlPercent)))
        .map((trade) => ({
            ...trade,
            pnlPercent: Number(trade.grossPnlPercent)
        }));

    const netTrades = strategyTrades.map((trade) => ({
        ...trade,
        pnlPercent: Number(trade.pnlPercent)
    }));

    const grossMean =
        grossTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / grossTrades.length;

    const netMean =
        netTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / netTrades.length;

    const grossCI = bootstrapBlockMeanCI(grossTrades, {
        iterations: args.iterations,
        seed: `gross-edge-check:${args.strategy}`
    });

    const netCI = bootstrapBlockMeanCI(netTrades, {
        iterations: args.iterations,
        seed: `net-edge-check:${args.strategy}`
    });

    console.log(`\nStrategy: ${args.strategy}`);
    console.log(`Sample size: ${grossTrades.length} trades with gross P&L data`);
    console.log(`\nGross expectancy (before costs): ${pct(grossMean)}`);
    console.log(`  95% block-bootstrap CI: ${pct(grossCI?.lower)} → ${pct(grossCI?.upper)}`);

    const grossSignificant =
        grossCI && Number.isFinite(grossCI.lower) && Number.isFinite(grossCI.upper) &&
        (grossCI.lower > 0 || grossCI.upper < 0);

    console.log(
        `  → ${grossSignificant ? "Distinguishable from zero" : "CI straddles zero — cannot rule out no real edge"}`
    );

    console.log(`\nNet expectancy (after costs): ${pct(netMean)}`);
    console.log(`  95% block-bootstrap CI: ${pct(netCI?.lower)} → ${pct(netCI?.upper)}`);
}

main().catch((error) => {
    console.error("Gross-edge check failed:", error);
    process.exit(1);
});
