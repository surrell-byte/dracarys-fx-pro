#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
    flattenResearchTrades
} from "../../src/js/analysis/scorecard.js";

import {
    buildAllStrategyDiagnostics,
    buildDiagnosticSummary
} from "../../src/js/analysis/strategyDiagnostics.js";

function parseArgs(argv) {
    const args = {
        input:
            "reports/analysis/multi-market-walk-forward.json",

        output:
            "reports/analysis/strategy-diagnostics.json",

        markdown:
            "reports/analysis/strategy-diagnostics.md"
    };

    for (
        let i = 0;
        i < argv.length;
        i += 1
    ) {
        if (
            argv[i] === "--input"
        ) {
            args.input =
                argv[++i];
        }

        if (
            argv[i] === "--output"
        ) {
            args.output =
                argv[++i];
        }

        if (
            argv[i] === "--markdown"
        ) {
            args.markdown =
                argv[++i];
        }
    }

    return args;
}

function fmt(
    value,
    digits = 3
) {
    return Number.isFinite(value)
        ? value.toFixed(digits)
        : "n/a";
}

function pct(
    value,
    digits = 3
) {
    return Number.isFinite(value)
        ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
        : "n/a";
}

function makeMarkdown(
    report,
    diagnostics,
    summary
) {
    const lines = [];

    lines.push(
        "# Strategy Diagnostics"
    );

    lines.push("");

    lines.push(
        `Generated: ${report.generatedAt ?? new Date().toISOString()}`
    );

    lines.push("");

    lines.push(
        "## Research Integrity"
    );

    lines.push("");

    lines.push(
        `- Method: ${report.researchMethod ?? "unknown"}`
    );

    lines.push(
        `- Optimisation performed: ${report.optimizationPerformed === true ? "yes" : "no"}`
    );

    lines.push(
        `- Market/timeframe combinations: ${report.coverage?.successfulCombinations ?? "n/a"} / ${report.coverage?.requestedCombinations ?? "n/a"}`
    );

    lines.push(
        `- All folds have full warm-up: ${report.dataQuality?.allFoldsHaveFullWarmup ? "YES" : "NO"}`
    );

    lines.push(
        `- All required HTF context available: ${report.dataQuality?.allFoldsHaveHTFContext ? "YES" : "NO"}`
    );

    lines.push("");

    lines.push(
        "## Diagnostic Summary"
    );

    lines.push("");

    lines.push(
        `- Strategies analysed: ${summary.totalStrategies}`
    );

    lines.push(
        `- Signal failures: ${summary.signalFailure}`
    );

    lines.push(
        `- Cost failures: ${summary.costFailure}`
    );

    lines.push(
        `- Exit model failures: ${summary.exitModelFailure}`
    );

    lines.push(
        `- Holding-period failures: ${summary.holdingPeriodFailure}`
    );

    lines.push("");

    lines.push(
        "## Strategy Diagnosis"
    );

    lines.push("");

    lines.push(
        "| Strategy | Trades | Gross Exp. | Net Exp. | Cost Drag | PF | Diagnosis | Recommendation |"
    );

    lines.push(
        "|---|---:|---:|---:|---:|---:|---|---|"
    );

    for (
        const row of diagnostics
    ) {
        lines.push(
            `| ${row.label} | ${row.sampleSize} | ${pct(row.gross?.expectancy)} | ${pct(row.net?.expectancy)} | ${pct(row.costs?.averageCostDrag)} | ${fmt(row.net?.profitFactor, 2)} | ${row.diagnosis?.category ?? "n/a"} | ${row.diagnosis?.recommendation ?? "n/a"} |`
        );
    }

    lines.push("");

    for (
        const row of diagnostics
    ) {
        lines.push(
            `## ${row.label}`
        );

        lines.push("");

        lines.push(
            `**Diagnosis:** ${row.diagnosis?.category ?? "n/a"}`
        );

        lines.push("");

        lines.push(
            `**Recommendation:** ${row.diagnosis?.recommendation ?? "n/a"}`
        );

        lines.push("");

        lines.push(
            "### Gross vs Net"
        );

        lines.push("");

        lines.push(
            `- Gross expectancy: ${pct(row.gross?.expectancy)}`
        );

        lines.push(
            `- Net expectancy: ${pct(row.net?.expectancy)}`
        );

        lines.push(
            `- Average cost drag: ${pct(row.costs?.averageCostDrag)}`
        );

        lines.push("");

        lines.push(
            "### MAE / MFE"
        );

        lines.push("");

        lines.push(
            `- Average MAE: ${pct(row.excursions?.averageMAE)}`
        );

        lines.push(
            `- Median MAE: ${pct(row.excursions?.medianMAE)}`
        );

        lines.push(
            `- Average MFE: ${pct(row.excursions?.averageMFE)}`
        );

        lines.push(
            `- Median MFE: ${pct(row.excursions?.medianMFE)}`
        );

        lines.push("");

        lines.push(
            "### Holding Time"
        );

        lines.push("");

        lines.push(
            `- Average candles: ${fmt(row.holding?.averageCandles, 1)}`
        );

        lines.push(
            `- Median candles: ${fmt(row.holding?.medianCandles, 1)}`
        );

        lines.push(
            `- Winning trades: ${fmt(row.holding?.averageWinningCandles, 1)} candles average`
        );

        lines.push(
            `- Losing trades: ${fmt(row.holding?.averageLosingCandles, 1)} candles average`
        );

        lines.push("");
            lines.push("");
            lines.push(            "### Exit Outcomes"        );
            lines.push("");
            lines.push(            `- Winners: ${row.outcomes?.winners ?? "n/a"} (${pct(row.outcomes?.winnerPct)})`        );
            lines.push(            `- Losers: ${row.outcomes?.losers ?? "n/a"} (${pct(row.outcomes?.loserPct)})`        );
            lines.push(            `- Stop-loss exits: ${pct(row.outcomes?.stopLossPct)}`        );
            lines.push(            `- Take-profit exits: ${pct(row.outcomes?.takeProfitPct)}`        );
            lines.push(            `- Timeout exits: ${pct(row.outcomes?.timeoutPct)}`        );
            lines.push("");
            lines.push(            "### Exit Reason Breakdown"        );
            lines.push("");
            for (            const [                reason,                data            ] of Object.entries(                row.exitReasons ?? {}            )) {
                lines.push(                `- ${reason}: ${data.trades} (${pct(data.percentage)})`            );
            }
            lines.push("");
    }

    return lines.join("\n");
}

async function main() {
    const args =
        parseArgs(
            process.argv.slice(2)
        );

    const inputPath =
        path.resolve(
            args.input
        );

    const outputPath =
        path.resolve(
            args.output
        );

    const markdownPath =
        path.resolve(
            args.markdown
        );

    const raw =
        await fs.readFile(
            inputPath,
            "utf8"
        );

    const report =
        JSON.parse(raw);

    const trades =
        flattenResearchTrades(
            report
        );

    const diagnostics =
        buildAllStrategyDiagnostics(
            trades
        );

    const summary =
        buildDiagnosticSummary(
            diagnostics
        );

    const output = {
        generatedAt:
            new Date().toISOString(),

        sourceReport:
            path.basename(
                inputPath
            ),

        methodology: {
            grossVsNet:
                true,

            executionCostsIncluded:
                true,

            maeMfe:
                true,

            exitReasons:
                true,

            holdingPeriod:
                true,

            marketBreakdown:
                true,

            timeframeBreakdown:
                true,

            regimeBreakdown:
                true,

            confidenceBreakdown:
                true,

            confidenceIntervalMethod:
                "block-bootstrap",

            optimizationPerformed:
                false
        },

        sample: {
            totalTrades:
                trades.length,

            strategies:
                summary.totalStrategies,

            marketTimeframeCombinations:
                report.coverage
                    ?.successfulCombinations ??
                null,

            folds:
                report.configuration
                    ?.folds ??
                null
        },

        summary,

        strategies:
            diagnostics
    };

    await fs.mkdir(
        path.dirname(outputPath),
        {
            recursive: true
        }
    );

    await fs.mkdir(
        path.dirname(markdownPath),
        {
            recursive: true
        }
    );

    await fs.writeFile(
        outputPath,
        JSON.stringify(
            output,
            null,
            2
        )
    );

    await fs.writeFile(
        markdownPath,
        makeMarkdown(
            report,
            diagnostics,
            summary
        )
    );

    console.log(
        `\nSaved:\n${outputPath}\n${markdownPath}`
    );

    console.log(
        `Strategies: ${summary.totalStrategies}`
    );

    console.log(
        `Signal failures: ${summary.signalFailure}`
    );

    console.log(
        `Cost failures: ${summary.costFailure}`
    );

    console.log(
        `Exit model failures: ${summary.exitModelFailure}`
    );

    console.log(
        `Holding-period failures: ${summary.holdingPeriodFailure}`
    );
}

main().catch(
    (error) => {
        console.error(
            "Strategy diagnostics failed:",
            error
        );

        process.exit(1);
    }
);
