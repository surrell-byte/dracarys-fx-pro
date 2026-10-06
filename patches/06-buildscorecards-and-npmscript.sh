#!/usr/bin/env bash
# 06-buildscorecards-and-npmscript.sh
# Replaces frontend/scripts/analysis/buildScorecards.js wholesale, and
# adds a "research-audit" script to frontend/package.json.
set -euo pipefail

FILE="frontend/scripts/analysis/buildScorecards.js"
DIR="$(dirname "$FILE")"
mkdir -p "$DIR"

if [ -f "$FILE" ]; then
  cp "$FILE" "$FILE.bak"
  echo "Backed up existing file to $FILE.bak"
fi

cat > "$FILE" <<'EOF'
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
        ["Strategy", "Trades", "Win%", "Expectancy", "95% Exp CI", "PF", "Sharpe", "MaxDD", "Profitable Folds", "Verdict"],
        audit.strategyScorecard.map((row) => [
            row.label, row.trades, pct(row.winRate, 1), pct(row.expectancy),
            row.expectancyCI ? `${pct(row.expectancyCI.lower)} → ${pct(row.expectancyCI.upper)}` : "n/a",
            fmt(row.profitFactor, 2), fmt(row.sharpe, 3), pct(-Math.abs(row.maxDrawdown ?? 0)),
            `${row.profitableFolds}/${row.totalFolds} (${fmt(row.profitableFoldPct, 0)}%)`, row.verdict
        ])
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

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(audit, null, 2));
    console.log(`\n✅ Research audit saved:\n${outputPath}`);
}

main().catch((error) => {
    console.error("Research audit failed:", error);
    process.exit(1);
});
EOF

echo "✓ Wrote $FILE"

# --- Add "research-audit" npm script to frontend/package.json --------------
PKG="frontend/package.json"
if [ ! -f "$PKG" ]; then
  echo "❌ $PKG not found." >&2
  exit 1
fi

cp "$PKG" "$PKG.bak"

python3 - "$PKG" <<'PY'
import json, sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    pkg = json.load(f)

pkg.setdefault("scripts", {})
pkg["scripts"]["research-audit"] = "vite-node -c vite.config.js scripts/analysis/buildScorecards.js"

with open(path, "w", encoding="utf-8") as f:
    json.dump(pkg, f, indent=2)
    f.write("\n")

print("✓ Added \"research-audit\" script to", path)
PY
