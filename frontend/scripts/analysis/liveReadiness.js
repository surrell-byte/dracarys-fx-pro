#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_REPORT = "reports/analysis/multi-market-walk-forward-continuous.json";
const DEFAULT_DIAGNOSTICS = "reports/analysis/strategy-diagnostics-continuous.json";

function parseArgs(argv) {
    const args = {
        report: DEFAULT_REPORT,
        diagnostics: DEFAULT_DIAGNOSTICS,
        minTradesPerStrategy: 100,
        requirePositiveNet: true,
        requireExchangeProtection: true,
        requireOcoVerification: true
    };

    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--report") args.report = argv[++i];
        if (argv[i] === "--diagnostics") args.diagnostics = argv[++i];
        if (argv[i] === "--min-trades") args.minTradesPerStrategy = Number(argv[++i]);
        if (argv[i] === "--allow-negative-net") args.requirePositiveNet = false;
        if (argv[i] === "--allow-unprotected-exits") args.requireExchangeProtection = false;
        if (argv[i] === "--allow-unverified-oco") args.requireOcoVerification = false;
    }

    if (!Number.isInteger(args.minTradesPerStrategy) || args.minTradesPerStrategy < 1) {
        throw new Error("--min-trades must be an integer >= 1");
    }
    return args;
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

function check(name, passed, detail) {
    return { name, passed, detail };
}

function evaluate(report, diagnostics, options) {
    const checks = [];
    const coverage = report.coverage ?? {};
    const quality = report.dataQuality ?? {};
    const rows = diagnostics.strategies ?? [];

    checks.push(check(
        "complete market/timeframe coverage",
        coverage.successfulCombinations === coverage.requestedCombinations && coverage.failedCombinations === 0,
        `${coverage.successfulCombinations ?? 0}/${coverage.requestedCombinations ?? 0} combinations`
    ));
    checks.push(check(
        "full warm-up and closed HTF context",
        quality.allFoldsHaveFullWarmup === true && quality.allFoldsHaveClosedHTFContext === true && quality.htfAuditPassed === true,
        `warmup=${quality.allFoldsHaveFullWarmup}, closedHTF=${quality.allFoldsHaveClosedHTFContext}, audit=${quality.htfAuditPassed}`
    ));
    checks.push(check(
        "timestamp ranges recorded",
        (report.results ?? []).filter((result) => !result.error).every((result) => Number.isFinite(result.from) && Number.isFinite(result.to) && result.from < result.to),
        "every successful result has an ordered from/to range"
    ));
    checks.push(check(
        "minimum evidence per strategy",
        rows.length > 0 && rows.every((row) => row.sampleSize >= options.minTradesPerStrategy),
        `${rows.filter((row) => row.sampleSize >= options.minTradesPerStrategy).length}/${rows.length} strategies meet ${options.minTradesPerStrategy} trades`
    ));
    checks.push(check(
        "no zero-trade strategies",
        rows.length > 0 && rows.every((row) => row.sampleSize > 0),
        `${rows.filter((row) => row.sampleSize > 0).length}/${rows.length} strategies produced scored trades`
    ));
    checks.push(check(
        "positive net expectancy",
        !options.requirePositiveNet || (rows.length > 0 && rows.every((row) => Number.isFinite(row.net?.expectancy) && row.net.expectancy > 0)),
        options.requirePositiveNet ? "every strategy must have positive net expectancy" : "performance gate disabled"
    ));
    checks.push(check(
        "no unresolved signal/cost/exit diagnosis",
        rows.length > 0 && rows.every((row) => !["SIGNAL_FAILURE", "SIGNAL_AND_EXIT_FAILURE", "COST_FAILURE", "EXIT_MODEL_FAILURE", "STOP_LOSS_DOMINATED", "HOLDING_PERIOD_FAILURE"].includes(row.diagnosis?.category)),
        "no strategy may have a known failure diagnosis"
    ));
    checks.push(check(
        "exchange-side protective exits",
        !options.requireExchangeProtection || (process.env.EXCHANGE_SIDE_PROTECTION === "true" && (!options.requireOcoVerification || process.env.BINANCE_OCO_VERIFIED_AT)),
        options.requireExchangeProtection
            ? `EXCHANGE_SIDE_PROTECTION=true and BINANCE_OCO_VERIFIED_AT are required${options.requireOcoVerification ? "" : "; OCO verification gate disabled"}`
            : "protection gate disabled"
    ));

    return checks;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const report = await readJson(options.report);
    const diagnostics = await readJson(options.diagnostics);
    const checks = evaluate(report, diagnostics, options);
    const passed = checks.every((item) => item.passed);

    console.log(`Live readiness: ${passed ? "PASS" : "BLOCKED"}`);
    for (const item of checks) {
        console.log(`${item.passed ? "PASS" : "BLOCK"} ${item.name}: ${item.detail}`);
    }

    if (!passed) process.exitCode = 1;
}

main().catch((error) => {
    console.error(`Live readiness could not be evaluated: ${error.message}`);
    process.exitCode = 1;
});
