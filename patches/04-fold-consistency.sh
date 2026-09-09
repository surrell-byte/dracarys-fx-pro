#!/usr/bin/env bash
# 04-fold-consistency.sh
# Fixes fold profitability consistency to include no-trade/negative folds
# in the denominator, instead of only counting folds that had trades.
set -euo pipefail

FILE="frontend/src/js/core/backtestRender.js"

if [ ! -f "$FILE" ]; then
  echo "❌ $FILE not found. Run this from the project root." >&2
  exit 1
fi

cp "$FILE" "$FILE.bak"

python3 - "$FILE" <<'PY'
import re, sys
path = sys.argv[1]
src = open(path, encoding="utf-8").read()

old_cell = '<td>${row.positiveFolds}/${row.foldsWithTrades || folds.length}</td>'
new_cell = (
    '<td>\n'
    '    ${row.positiveFolds}/${folds.length}\n'
    '    <span class="subtle">(${formatNumber(row.profitableFoldPct, 0)}%)</span>\n'
    '</td>'
)

if old_cell in src:
    src = src.replace(old_cell, new_cell, 1)
    print("✓ Replaced the positiveFolds table cell")
else:
    print("⚠️  Could not find the exact table-cell line automatically.")
    print("    Search for: row.positiveFolds}/${row.foldsWithTrades")
    print("    and replace with the block shown in the chat instructions.")

open(path, "w", encoding="utf-8").write(src)
PY

echo ""
echo "⚠️  MANUAL STEP: find the block that computes positiveFolds / foldsWithTrades"
echo "   (search for 'foldsWithTrades' in $FILE) and replace it with:"
cat <<'BLOCK'

    const positiveFolds = perFold.filter((row) => row && row.totalPnl > 0).length;

    const profitableFoldPct = folds.length > 0 ? (positiveFolds / folds.length) * 100 : 0;

    const totalPnl = pnls.reduce((sum, value) => sum + value, 0);
    const avgPnl = folds.length > 0 ? totalPnl / folds.length : 0;

    return { label, perFold, positiveFolds, profitableFoldPct, avgPnl, totalPnl };
BLOCK

echo ""
echo "Backup saved at $FILE.bak"
