#!/bin/bash
# apply-scheduler-phase4-enable-forex.sh
#
# Enables FX pairs alongside crypto. Run this AFTER
# apply-scheduler-phase3-env-and-notify.sh.
#
# Why this isn't just "uncomment EUR/USD in config.js":
# Twelve Data's free tier is 800 calls/day, 8/min. The scheduler currently
# polls EVERY symbol EVERY 60s regardless of asset class - fine for
# crypto (Binance, no key/limit), but one forex pair at that rate alone
# is 1,440 calls/day, blowing the daily budget by itself.
#
# Fix: give each symbol its own optional pollIntervalMs. Crypto keeps
# polling every 60s (unlimited, free). Forex pairs poll every 5 minutes
# instead - still uses the same 1-minute candles/timeframe for strategy
# consistency, just fetches them less often. Budget at 5 min:
#   2 forex pairs x (24h * 60min / 5min) = 2 x 288 = 576 calls/day
# well under the 800/day cap, with headroom to add a 3rd pair later
# (up to ~2 more pairs at this interval, or tighten the interval on fewer
# pairs - the math is in the config.js comment for whenever you adjust).
#
# Run from your project root:
#   chmod +x apply-scheduler-phase4-enable-forex.sh
#   ./apply-scheduler-phase4-enable-forex.sh

set -euo pipefail

if [ ! -f "frontend/scripts/scheduler/runScheduler.js" ]; then
    echo "Can't find frontend/scripts/scheduler/runScheduler.js - run this from your project root." >&2
    exit 1
fi

cd frontend

# --- 1. config.js: replace symbols list with crypto + forex, each carrying its own pollIntervalMs ---
python3 << 'PYEOF'
path = "scripts/scheduler/config.js"
with open(path) as f:
    content = f.read()

old_symbols_block = '''    symbols: [
        { symbol: "BTC/USDT", assetClass: "crypto" },
        { symbol: "ETH/USDT", assetClass: "crypto" }
        // { symbol: "EUR/USD", assetClass: "forex" },
    ],'''

new_symbols_block = '''    symbols: [
        // Crypto: Binance/ccxt, no key, no meaningful rate limit at this
        // volume - keep polling every pollIntervalMs (60s) below.
        { symbol: "BTC/USDT", assetClass: "crypto" },
        { symbol: "ETH/USDT", assetClass: "crypto" },

        // Forex: Twelve Data, free tier = 800 calls/day, 8/min.
        // pollIntervalMs overrides the global default per-symbol so we
        // don't blow the daily budget. At 5 min (300_000ms) each pair
        // costs 288 calls/day: 2 pairs = 576/day, leaving headroom.
        // Raising the pair count or lowering the interval? Re-check the
        // math: (86400 / (pollIntervalMs/1000)) * numPairs must stay
        // under ~750/day to leave slack for retries/manual `npm run report`.
        { symbol: "EUR/USD", assetClass: "forex", pollIntervalMs: 300_000 },
        { symbol: "GBP/USD", assetClass: "forex", pollIntervalMs: 300_000 }
    ],'''

assert old_symbols_block in content, "Expected symbols block not found in config.js - aborting to avoid a bad edit"
content = content.replace(old_symbols_block, new_symbols_block, 1)

with open(path, "w") as f:
    f.write(content)
print("config.js: enabled EUR/USD + GBP/USD with 5-min poll intervals")
PYEOF

# --- 2. runScheduler.js: track last-polled time per symbol, only fetch when that symbol's own interval has elapsed ---
python3 << 'PYEOF'
path = "scripts/scheduler/runScheduler.js"
with open(path) as f:
    content = f.read()

if "lastPolled" in content:
    print("runScheduler.js already has per-symbol polling, leaving it alone.")
else:
    old = '''async function scanAll() {
    console.log(`\\n--- scan ${new Date().toLocaleString()} ---`);
    for (const target of config.symbols) {
        await scanSymbol(target);
    }
}'''
    new = '''const lastPolled = new Map();

function isDue(target, now) {
    const interval = target.pollIntervalMs ?? config.pollIntervalMs;
    const last = lastPolled.get(target.symbol) ?? 0;
    return now - last >= interval;
}

async function scanAll() {
    console.log(`\\n--- scan ${new Date().toLocaleString()} ---`);
    const now = Date.now();
    for (const target of config.symbols) {
        if (!isDue(target, now)) continue;
        lastPolled.set(target.symbol, now);
        await scanSymbol(target);
    }
}'''
    assert old in content, "Expected scanAll() block not found in runScheduler.js - aborting to avoid a bad edit"
    content = content.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(content)
    print("runScheduler.js: added per-symbol poll interval tracking")
PYEOF

echo ""
echo "Done. Summary:"
echo "  - EUR/USD + GBP/USD enabled, polling every 5 min (well under Twelve Data's free 800/day cap)"
echo "  - BTC/USDT + ETH/USDT keep polling every 60s as before, unaffected"
echo "  - The main loop still wakes every 60s, but only fetches a symbol"
echo "    once its own pollIntervalMs has actually elapsed"
echo ""
echo "Restart the running service so it picks up the changes:"
echo "  launchctl unload ~/Library/LaunchAgents/com.otcsignal.scheduler.plist"
echo "  launchctl load ~/Library/LaunchAgents/com.otcsignal.scheduler.plist"
echo ""
echo "Watch for the first forex fetch (can take up to 5 min to appear):"
echo "  tail -f frontend/data/scheduler.log"
