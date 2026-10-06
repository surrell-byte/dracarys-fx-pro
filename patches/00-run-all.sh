#!/usr/bin/env bash
# 00-run-all.sh
# Runs each patch step in order, testing after every step so a regression
# is caught immediately instead of after a big bang apply.
#
# Usage: run this FROM THE PROJECT ROOT (the folder with frontend/ + backend/).
#   bash patches/00-run-all.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step () {
  local name="$1"
  local script="$2"
  echo ""
  echo "=================================================================="
  echo "  $name"
  echo "=================================================================="
  bash "$HERE/$script"
}

test_step () {
  echo ""
  echo "--- running tests -------------------------------------------------"
  if npm --prefix frontend test; then
    echo "✓ tests passed"
  else
    echo "❌ tests failed — stop here, review the diff, fix, then re-run"
    echo "   the remaining scripts manually."
    exit 1
  fi
}

echo "Installing dependencies first (skip with SKIP_INSTALL=1)..."
if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  npm --prefix frontend install
fi

step "1/7 HTF candle-close fix"          01-htf-fix.sh
echo "⚠️  Step 2 (fold warm-up + open-position handling) is MANUAL — see its output."
step "2/7 fold-1 warmup + open-pos (generates snippets)" 02-warmup-openpos.sh
echo ""
echo "PAUSING: apply the manual edits printed above to"
echo "  frontend/src/js/analysis/backtestEngine.js"
echo "before continuing. Press Enter when done, or Ctrl+C to stop."
read -r _

step "3/7 multi-market runner rewrite"   03-runner.sh
step "4/7 fold consistency fix"          04-fold-consistency.sh
echo ""
echo "PAUSING: step 4 needs one manual block swap in backtestRender.js"
echo "(printed above). Press Enter when done."
read -r _

step "5/7 scorecard.js rewrite"          05-scorecard.sh
step "6/7 buildScorecards.js + npm script" 06-buildscorecards-and-npmscript.sh
step "7/7 tests"                         07-tests.sh

test_step

echo ""
echo "✅ All steps applied and tests passed."
echo "Next: npm run build, then:"
echo "  npm run walk-forward -- --limit 1000 --folds 3 --warmup 320"
echo "  npm run research-audit"
