#!/usr/bin/env bash
# 01-htf-fix.sh
# Fixes HTF candle-close detection + honest higherTimeframeApplied flag.
# Run from the project root (the folder containing frontend/).
set -euo pipefail

FILE="frontend/src/js/analysis/backtestEngine.js"

if [ ! -f "$FILE" ]; then
  echo "❌ $FILE not found. Run this from the project root." >&2
  exit 1
fi

cp "$FILE" "$FILE.bak"

python3 - "$FILE" <<'PY'
import re, sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()

# --- 1. Replace buildHigherTimeframeLookup() wholesale ---------------------
new_fn = '''function buildHigherTimeframeLookup(dailyCandles) {
    if (!Array.isArray(dailyCandles) || dailyCandles.length < 200) {
        return () => "NEUTRAL";
    }

    // Daily candle timestamps represent the candle OPEN. We can't assume
    // every daily candle spans exactly 86,400,000ms (FX daily candles shift
    // with timezone/DST/broker session boundaries), so a daily candle only
    // becomes usable once the NEXT daily candle has opened.
    const sorted = dailyCandles
        .filter((c) => Number.isFinite(c?.time) && Number.isFinite(c?.close))
        .slice()
        .sort((a, b) => a.time - b.time);

    if (sorted.length < 200) {
        return () => "NEUTRAL";
    }

    const closes = sorted.map((c) => Number(c.close));
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);
    const offset50 = closes.length - ema50.length;
    const offset200 = closes.length - ema200.length;

    const trendByIndex = sorted.map((_, i) => {
        const e50 = ema50[i - offset50];
        const e200 = ema200[i - offset200];
        if (!Number.isFinite(e50) || !Number.isFinite(e200)) return "NEUTRAL";
        if (e50 > e200) return "UP";
        if (e50 < e200) return "DOWN";
        return "NEUTRAL";
    });

    // Candle i counts as "closed" once the NEXT daily open <= timestamp.
    // We intentionally never use the still-forming current daily candle.
    return (timestamp) => {
        if (!Number.isFinite(timestamp)) return "NEUTRAL";

        let lo = 0, hi = sorted.length - 2, result = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const nextDailyOpen = sorted[mid + 1].time;
            if (nextDailyOpen <= timestamp) {
                result = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        return result >= 0 ? trendByIndex[result] : "NEUTRAL";
    };
}'''

pattern = re.compile(r"function buildHigherTimeframeLookup\([^)]*\)\s*\{.*?\n\}", re.DOTALL)
if not pattern.search(src):
    print("⚠️  Could not find buildHigherTimeframeLookup() automatically.")
    print("    Apply CHANGE 1 from the code blocks by hand.")
else:
    src = pattern.sub(new_fn, src, count=1)
    print("✓ Replaced buildHigherTimeframeLookup()")

# --- 2. higherTimeframeApplied metadata flag --------------------------------
old_flag = "higherTimeframeApplied: Boolean(dailyCandles),"
new_flag = (
    "higherTimeframeApplied:\n"
    "                usesHigherTimeframe &&\n"
    "                Array.isArray(dailyCandles) &&\n"
    "                dailyCandles.length >= 200,"
)
if old_flag in src:
    src = src.replace(old_flag, new_flag, 1)
    print("✓ Fixed higherTimeframeApplied flag")
else:
    print("⚠️  Could not find 'higherTimeframeApplied: Boolean(dailyCandles),' — apply CHANGE 2 by hand.")

# --- 3. Warning condition ----------------------------------------------------
old_warn = "if (usesHigherTimeframe && !dailyCandles) {"
new_warn = (
    "if (\n"
    "                usesHigherTimeframe &&\n"
    "                (!Array.isArray(dailyCandles) || dailyCandles.length < 200)\n"
    "            ) {"
)
if old_warn in src:
    src = src.replace(old_warn, new_warn, 1)
    print("✓ Fixed HTF insufficient-data warning condition")
else:
    print("⚠️  Could not find the old HTF warning condition — apply CHANGE 3 by hand.")

# --- 4. Import applyFeeToPnl (needed later by 02-warmup-openpos.sh) --------
old_import = 'import { applyExitCost } from "@analysis/executionCosts.js";'
new_import = 'import { applyExitCost, applyFeeToPnl } from "@analysis/executionCosts.js";'
if old_import in src:
    src = src.replace(old_import, new_import, 1)
    print("✓ Updated executionCosts import (applyFeeToPnl)")
else:
    print("ℹ️  Old import line not found verbatim — add 'applyFeeToPnl' to the executionCosts import by hand.")

open(path, "w", encoding="utf-8").write(src)
PY

echo ""
echo "Done. Backup saved at $FILE.bak"
echo "Review the diff:  diff -u \"$FILE.bak\" \"$FILE\""
