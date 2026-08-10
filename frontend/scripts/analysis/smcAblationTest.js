#!/usr/bin/env node
// scripts/analysis/smcAblationTest.js
//
// Answers a specific question from the original architecture review:
// "SMC modules should be treated as hypotheses, not facts... the
// backtesting system can determine: does this feature actually add
// predictive value?"
//
// Runs the "AI Confidence Pipeline" strategy's backtest multiple times
// against the same historical candles:
//   1. Baseline - every voting module included (current default behavior)
//   2. Once per SMC module, with just that module's vote excluded
//   3. All SMC modules excluded at once
//
// Compares expectancy/profit-factor/Sharpe/win-rate between each run and
// the baseline. If excluding a module makes performance BETTER (or
// unchanged within noise), that module isn't earning its vote. If
// excluding it makes performance meaningfully WORSE, that's real evidence
// it's contributing - not just "sounding sophisticated" (the review's
// framing).
//
// This only touches the "aiConfidence" strategy - it's the only one of
// the 14 strategies whose scoring includes the SMC modules at all (see
// scoreAiConfidencePipeline in signalEngine.js). It does not change any
// production behavior: excludeVoteModules defaults to [] everywhere else,
// so normal signal generation is completely unaffected by this script
// existing.
//
// Usage:
//   node scripts/analysis/smcAblationTest.js --symbol BTC/USDT --timeframe 1m --limit 5000
//   node scripts/analysis/smcAblationTest.js --symbol EUR/USD --assetClass forex --timeframe 5m --limit 3000
//
// Requires network access to Binance (crypto) or TWELVEDATA_API_KEY env
// var (forex) - same data sources the live scheduler uses
// (scripts/scheduler/candles.js).

import { fetchCandles } from "../scheduler/candles.js";
import { runBacktest } from "../../src/js/analysis/backtestEngine.js";

const SMC_MODULES = ["orderBlock", "fairValueGap", "liquiditySweep", "breakerBlock", "mitigation"];
const STRATEGY_ID = "aiConfidence";

function parseArgs(argv) {
    const args = { symbol: "BTC/USDT", assetClass: "crypto", timeframe: "1m", limit: 5000, payoutRatio: 0.85 };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        if (!key.startsWith("--")) continue;
        const value = argv[i + 1];
        switch (key) {
            case "--symbol": args.symbol = value; i += 1; break;
            case "--assetClass": args.assetClass = value; i += 1; break;
            case "--timeframe": args.timeframe = value; i += 1; break;
            case "--limit": args.limit = Number(value); i += 1; break;
            case "--payoutRatio": args.payoutRatio = Number(value); i += 1; break;
            default: break;
        }
    }
    return args;
}

function pct(n, digits = 2) {
    return n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function num(n, digits = 2) {
    return n == null ? "n/a" : n.toFixed(digits);
}

async function runVariant(candles, label, excludeVoteModules, payoutRatio) {
    const result = await runBacktest(candles, {
        strategyIds: [STRATEGY_ID],
        payoutRatio,
        assetClass: null, // ablation is about signal quality, not execution cost - keep cost model out of the comparison
        extraSignalContext: { excludeVoteModules }
    });
    const row = result.spotLeaderboard.find((r) => r.strategy === STRATEGY_ID);
    return { label, excluded: excludeVoteModules, ...row };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    console.log(`Fetching ${args.limit} ${args.timeframe} candles for ${args.symbol} (${args.assetClass})...`);
    const candles = await fetchCandles({
        symbol: args.symbol,
        assetClass: args.assetClass,
        timeframe: args.timeframe,
        limit: args.limit
    });
    console.log(`Got ${candles.length} candles. Running ablation variants for strategy "${STRATEGY_ID}"...\n`);

    const variants = [
        { label: "baseline (all modules)", exclude: [] },
        ...SMC_MODULES.map((m) => ({ label: `without ${m}`, exclude: [m] })),
        { label: "without ALL SMC modules", exclude: SMC_MODULES }
    ];

    const results = [];
    for (const v of variants) {
        // Sequential, not Promise.all - runBacktest already reports its own
        // progress and this keeps output order deterministic and readable.
        const result = await runVariant(candles, v.label, v.exclude, args.payoutRatio);
        results.push(result);
    }

    const baseline = results[0];

    console.log("Results (sorted by expectancy, best first):\n");
    const sorted = [...results].sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));

    const header = ["Variant", "Trades", "Win%", "TotalPnL", "Expectancy", "ProfitFactor", "Sharpe", "Δ Expectancy vs baseline"];
    console.log(header.join(" | "));
    console.log(header.map(() => "---").join(" | "));

    sorted.forEach((r) => {
        const deltaVsBaseline = r === baseline ? "-" : pct((r.expectancy ?? 0) - (baseline.expectancy ?? 0), 3);
        console.log([
            r.label,
            r.trades,
            num(r.winRate, 1) + "%",
            pct(r.totalPnl),
            r.expectancy != null ? pct(r.expectancy, 3) : "n/a",
            r.profitFactor != null ? num(r.profitFactor) : "n/a",
            r.sharpe != null ? num(r.sharpe, 3) : "n/a",
            deltaVsBaseline
        ].join(" | "));
    });

    console.log("\nHow to read this:");
    console.log("  - A module whose 'without <module>' row has LOWER expectancy than baseline");
    console.log("    is contributing - removing its vote hurt performance.");
    console.log("  - A module whose 'without <module>' row has HIGHER or EQUAL expectancy");
    console.log("    than baseline is not earning its vote on this sample - the model would");
    console.log("    have done as well or better ignoring it.");
    console.log("  - Trust this more with a larger --limit (more trades = more reliable");
    console.log("    expectancy estimate - check the 'Trades' column isn't tiny before");
    console.log("    concluding anything from a single run).");
    console.log("  - Re-run across a few different symbols/timeframes before removing a");
    console.log("    module from production - one sample isn't enough to retire a feature.");
}

main().catch((error) => {
    console.error("Ablation test failed:", error.message);
    process.exit(1);
});
