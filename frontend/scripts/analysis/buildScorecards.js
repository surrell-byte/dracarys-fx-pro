#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { buildResearchAudit } from "../../src/js/analysis/scorecard.js";

function parseArgs(argv) {
    const args = {
        input: "reports/analysis/multi-market-walk-forward.json",
        output: "reports/analysis/research-audit.json"
    };

    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--input") args.input = argv[++i];
        if (argv[i] === "--output") args.output = argv[++i];
    }

    return args;
}

function fmt(value, digits = 3) {
    return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function pct(value, digits = 2) {
    return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%` : "n/a";
}

function printTable(title, columns, rows) {
    console.log(`\n${title}\n`);
    console.log(columns.join(" | "));
    console.log(columns.map(() => "---").join(" | "));
    for (const row of rows) console.log(row.join(" | "));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const inputPath = path.resolve(args.input);
    const outputPath = path.resolve(args.output);

    console.log(`Reading research report:\n${inputPath}`);
    const raw = await fs.readFile(inputPath, "utf8");
    const report = JSON.parse(raw);
    const audit = buildResearchAudit(report);

    printTable(
        "STRATEGY SCORECARD",
        [
            "Strategy",
            "Trades",
            "Win%",
            "Expectancy",
            "95% Block CI",
            "PF",
            "Sharpe",
            "MaxDD",
            "Positive",
            "Negative",
            "Flat",
            "Verdict"
        ],
        audit.strategyScorecard.map(
            (row) => [
                row.label,
                row.trades,
                pct(row.winRate, 1),
                pct(row.expectancy),

                row.expectancyCI
                    ? `${pct(row.expectancyCI.lower)} → ${pct(row.expectancyCI.upper)}`
                    : "n/a",

                fmt(row.profitFactor, 2),
                fmt(row.sharpe, 3),

                pct(
                    -Math.abs(
                        row.maxDrawdown ?? 0
                    )
                ),

                row.profitableFolds,
                row.losingFolds,
                row.flatFolds,

                row.verdict
            ]
        )
    );

    printTable(
        "MARKET SCORECARD",
        ["Market", "Trades", "Win%", "Expectancy", "PF", "Sharpe", "MaxDD"],
        audit.assetScorecard.map((row) => [
            row.symbol, row.trades, pct(row.winRate, 1), pct(row.expectancy),
            fmt(row.profitFactor, 2), fmt(row.sharpe, 3), pct(-Math.abs(row.maxDrawdown ?? 0))
        ])
    );

    printTable(
        "TIMEFRAME SCORECARD",
        ["Timeframe", "Trades", "Win%", "Expectancy", "PF", "Sharpe", "MaxDD"],
        audit.timeframeScorecard.map((row) => [
            row.timeframe, row.trades, pct(row.winRate, 1), pct(row.expectancy),
            fmt(row.profitFactor, 2), fmt(row.sharpe, 3), pct(-Math.abs(row.maxDrawdown ?? 0))
        ])
    );

    printTable(
        "REGIME SCORECARD",
        ["Regime", "Trades", "Win%", "Expectancy", "PF", "Sharpe", "MaxDD"],
        audit.regimeScorecard.map((row) => [
            row.regime, row.trades, pct(row.winRate, 1), pct(row.expectancy),
            fmt(row.profitFactor, 2), fmt(row.sharpe, 3), pct(-Math.abs(row.maxDrawdown ?? 0))
        ])
    );

    printTable(
        "STRATEGY × MARKET",
        ["Strategy", "Market", "Trades", "Expectancy", "PF", "MaxDD", "Verdict"],
        audit.strategyMarket.map((row) => [
            row.strategy, row.symbol, row.trades, pct(row.expectancy),
            fmt(row.profitFactor, 2), pct(-Math.abs(row.maxDrawdown ?? 0)), row.verdict
        ])
    );

    printTable(
        "STRATEGY × TIMEFRAME",
        ["Strategy", "Timeframe", "Trades", "Expectancy", "PF", "MaxDD", "Verdict"],
        audit.strategyTimeframe.map((row) => [
            row.strategy, row.timeframe, row.trades, pct(row.expectancy),
            fmt(row.profitFactor, 2), pct(-Math.abs(row.maxDrawdown ?? 0)), row.verdict
        ])
    );

    printTable(
        "STRATEGY × CONFIDENCE",
        ["Strategy", "Band", "Trades", "Win%", "Expectancy", "PF", "Verdict"],
        audit.confidenceScorecard.map((row) => [
            row.label, row.band, row.trades, pct(row.winRate, 1), pct(row.expectancy),
            fmt(row.profitFactor, 2), row.verdict
        ])
    );

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(audit, null, 2));
    console.log(`\n✅ Research audit saved:\n${outputPath}`);
}

main().catch((error) => {
    console.error("Research audit failed:", error);
    process.exit(1);
});
