#!/usr/bin/env node
// scripts/analysis/buildScorecards.js
//
// Reads the JSON report produced by multiMarketWalkForward.js and prints
// strategy / regime / asset scorecards built from it. Thin CLI wrapper
// over src/js/analysis/scorecard.js.
//
// Usage:
//   node scripts/analysis/buildScorecards.js
//   node scripts/analysis/buildScorecards.js --input reports/analysis/custom.json

import fs from "node:fs/promises";
import path from "node:path";

import { buildStrategyScorecard, buildRegimeScorecard, buildAssetScorecard } from "../../src/js/analysis/scorecard.js";

function parseArgs(argv) {
    const args = { input: "reports/analysis/multi-market-walk-forward.json" };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--input") args.input = argv[++i];
    }
    return args;
}

function pct(n, digits = 3) {
    return n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function num(n, digits = 2) {
    return n == null ? "n/a" : n.toFixed(digits);
}

function printTable(title, header, rows) {
    console.log(`\n${title}\n`);
    console.log(header.join(" | "));
    console.log(header.map(() => "---").join(" | "));
    rows.forEach((row) => console.log(row.join(" | ")));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const inputPath = path.resolve(args.input);

    console.log(`Reading walk-forward report: ${inputPath}`);

    const raw = await fs.readFile(inputPath, "utf8");
    const report = JSON.parse(raw);
    const rows = (report.results ?? []).flatMap((r) => r.rows ?? []);

    if (!rows.length) {
        console.error("No rows found in this report - did the walk-forward run produce any successful (non-error) results?");
        process.exit(1);
    }

    console.log(`Loaded ${rows.length} rows from ${report.results.length} market/timeframe results.`);

    const strategyScorecard = buildStrategyScorecard(rows);
    printTable(
        "STRATEGY SCORECARD (sorted by avg expectancy, best first)",
        ["Strategy", "Samples", "Trades", "AvgExpectancy", "MedianExpectancy", "AvgWinRate", "AvgPF", "AvgSharpe", "Consistency%"],
        strategyScorecard.map((r) => [
            r.strategy, r.samples, r.totalTrades, pct(r.avgExpectancy), pct(r.medianExpectancy),
            num(r.avgWinRate, 1) + "%", num(r.avgProfitFactor), num(r.avgSharpe, 3), num(r.expectancyConsistency, 1)
        ])
    );

    const assetScorecard = buildAssetScorecard(rows);
    printTable(
        "ASSET SCORECARD (sorted by avg expectancy, best first)",
        ["Symbol", "Samples", "Trades", "AvgExpectancy", "AvgWinRate", "AvgPF"],
        assetScorecard.map((r) => [r.symbol, r.samples, r.totalTrades, pct(r.avgExpectancy), num(r.avgWinRate, 1) + "%", num(r.avgProfitFactor)])
    );

    const regimeScorecard = buildRegimeScorecard(rows);

    if (regimeScorecard.length === 1 && regimeScorecard[0].regime === "UNKNOWN") {
        console.log(
            "\nREGIME SCORECARD: skipped - rows don't carry a `regime` field yet " +
            "(the walk-forward runner doesn't tag folds with a market regime). " +
            "Wire regime detection into the row-producing side to enable this."
        );
    } else {
        printTable(
            "REGIME SCORECARD (sorted by avg expectancy, best first)",
            ["Regime", "Samples", "Trades", "AvgExpectancy", "AvgWinRate", "AvgPF"],
            regimeScorecard.map((r) => [r.regime, r.samples, r.totalTrades, pct(r.avgExpectancy), num(r.avgWinRate, 1) + "%", num(r.avgProfitFactor)])
        );
    }
}

main().catch((error) => {
    console.error("buildScorecards failed:", error.message);
    process.exit(1);
});
