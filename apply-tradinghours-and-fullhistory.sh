#!/bin/bash
# Run this from ~/dracarys-fx-pro/frontend on the GCP VM.
# Applies:
#   1. blockedTradingHoursUtc config (13:00-18:00 UTC, per weekly analysis)
#   2. runScheduler.js gate that skips opening NEW trades in those hours
#   3. db.js getReportSnapshots cap raised from 100 to 3650 (full history)
set -e

cd "$(dirname "$0")" 2>/dev/null || true
if [ ! -f "scripts/scheduler/config.js" ]; then
  echo "Run this from ~/dracarys-fx-pro/frontend (scripts/scheduler/config.js not found here)."
  exit 1
fi

cp scripts/scheduler/config.js scripts/scheduler/config.js.bak
cp scripts/scheduler/runScheduler.js scripts/scheduler/runScheduler.js.bak
cp scripts/scheduler/db.js scripts/scheduler/db.js.bak

python3 - << 'PYEOF'
import re

# --- config.js: add blockedTradingHoursUtc ---
with open("scripts/scheduler/config.js") as f:
    content = f.read()

if "blockedTradingHoursUtc" not in content:
    marker = "    maxHoldCandles: 60,"
    addition = """    maxHoldCandles: 60,

    // Hours (UTC, 0-23) during which NEW signals should not be opened.
    // Backtested week of 2026-08-01 showed a 0% win rate across 44 trades
    // opened 13:00-18:00 UTC (US session open + high-impact news window),
    // vs 57-75% win rate in the surrounding hours. Trades already open
    // when a blocked hour starts are left alone and still resolve
    // normally - this only gates opening NEW ones. Empty array = no filter.
    blockedTradingHoursUtc: [13, 14, 15, 16, 17, 18],"""
    content = content.replace(marker, addition, 1)
    with open("scripts/scheduler/config.js", "w") as f:
        f.write(content)
    print("config.js: added blockedTradingHoursUtc")
else:
    print("config.js: blockedTradingHoursUtc already present, skipped")

# --- runScheduler.js: gate new signal opens ---
with open("scripts/scheduler/runScheduler.js") as f:
    content = f.read()

if "blockedTradingHoursUtc" not in content:
    marker = """    for (const strategyId of strategyIds) {
        const signal = generateSignal(candles, strategyId);
        if (!shouldOpen(signal)) continue;
        if (db.getOpenSignals(symbol, strategyId).length > 0) continue;"""
    addition = """    const currentHourUtc = new Date().getUTCHours();
    if (config.blockedTradingHoursUtc?.includes(currentHourUtc)) return;

    for (const strategyId of strategyIds) {
        const signal = generateSignal(candles, strategyId);
        if (!shouldOpen(signal)) continue;
        if (db.getOpenSignals(symbol, strategyId).length > 0) continue;"""
    content = content.replace(marker, addition, 1)
    with open("scripts/scheduler/runScheduler.js", "w") as f:
        f.write(content)
    print("runScheduler.js: added trading-hours gate")
else:
    print("runScheduler.js: gate already present, skipped")

# --- db.js: raise snapshot limit cap ---
with open("scripts/scheduler/db.js") as f:
    content = f.read()

old = "Math.max(1, Math.min(Number(limit) || 12, 100))"
new = "Math.max(1, Math.min(Number(limit) || 12, 3650))"
if old in content:
    content = content.replace(old, new, 1)
    with open("scripts/scheduler/db.js", "w") as f:
        f.write(content)
    print("db.js: raised snapshot limit cap to 3650")
else:
    print("db.js: cap already raised or pattern not found, check manually")
PYEOF

echo ""
echo "Done. Backups saved as *.bak next to each file."
echo "Restart the scheduler service to pick up the changes:"
echo "  sudo systemctl restart dracarys-scheduler.service"
echo "  sudo systemctl status dracarys-scheduler.service"
