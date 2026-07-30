#!/bin/zsh
# apply-scheduler-phase3-env-and-notify.sh
#
# Fixes 3 things found in the scheduler:
#   1. Nothing loaded frontend/.env into process.env for the Node scheduler
#      process (only Vite's browser build sees VITE_-prefixed vars). Adds
#      the `dotenv` package and loads it at the top of runScheduler.js and
#      cli-report.js.
#   2. frontend/.env had leading spaces on the Telegram lines and no
#      trailing newline - both break normal .env parsing. Rewrites it clean.
#   3. Wires up Telegram notifications (creates notify.js, updates
#      config.js/runScheduler.js/generateReport.js/cli-report.js exactly as
#      apply-scheduler-phase2-notifications.sh intended - that script alone
#      was never enough because of bug #1 above).
#
# Run from your project root (same level as frontend/):
#   chmod +x apply-scheduler-phase3-env-and-notify.sh
#   ./apply-scheduler-phase3-env-and-notify.sh

set -euo pipefail

if [ ! -f "frontend/scripts/scheduler/runScheduler.js" ]; then
    echo "Can't find frontend/scripts/scheduler/runScheduler.js - run this from your project root." >&2
    exit 1
fi

cd frontend

# --- 1. Fix .env formatting + add plain (non-VITE_) keys the Node process needs ---
if [ -f .env ]; then
    cp .env .env.bak
    echo "Backed up existing .env to frontend/.env.bak"
fi

TWELVEDATA_KEY=$(grep -o 'VITE_TWELVEDATA_API_KEY=.*' .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)
TELEGRAM_TOKEN=$(grep -o 'TELEGRAM_BOT_TOKEN=.*' .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)
TELEGRAM_CHAT=$(grep -o 'TELEGRAM_CHAT_ID=.*' .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)

cat > .env << ENVEOF
VITE_TWELVEDATA_API_KEY=${TWELVEDATA_KEY}
TWELVEDATA_API_KEY=${TWELVEDATA_KEY}
TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT}
ENVEOF

echo "Rewrote frontend/.env with clean formatting + plain TWELVEDATA_API_KEY for the scheduler."

# --- 2. Add dotenv dependency ---
npm install dotenv --save

# --- 3. notify.js ---
cat > scripts/scheduler/notify.js << 'FILEEOF'
// Telegram push notifications for high-confidence signals + the daily
// report summary. Isolated here so a notification failure (bad token,
// network hiccup, Telegram down) never takes down the scheduler - every
// send is wrapped and just logs a warning on failure.
//
// Setup (one-time):
//   1. Message @BotFather on Telegram, send /newbot, follow the prompts.
//      You'll get back a token that looks like 123456789:AAExxxxxxxxxxx
//   2. Message your new bot anything (e.g. "hi") so it's allowed to reply
//      to you, then visit:
//        https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
//      and find "chat":{"id": ...} in the response - that number is your
//      chat id.
//   3. Put both in frontend/.env:
//        TELEGRAM_BOT_TOKEN=123456789:AAExxxxxxxxxxx
//        TELEGRAM_CHAT_ID=987654321

let warnedMissingConfig = false;

export async function sendTelegramMessage(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        if (!warnedMissingConfig) {
            console.warn(
                "Telegram notifications are enabled in config.js but " +
                "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set in frontend/.env " +
                "- skipping notifications (see notify.js header for setup steps)."
            );
            warnedMissingConfig = true;
        }
        return false;
    }

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
        });
        if (!res.ok) {
            const body = await res.text();
            console.warn(`Telegram send failed (${res.status}): ${body}`);
            return false;
        }
        return true;
    } catch (err) {
        console.warn("Telegram send failed:", err.message);
        return false;
    }
}

const QUALITY_RANK = { Low: 0, Medium: 1, High: 2 };

export function meetsNotifyThreshold(signal, notifyConfig) {
    if (!notifyConfig?.enabled) return false;
    const confidenceOk = (signal.confidence ?? 0) >= (notifyConfig.minConfidence ?? 0);
    const qualityOk = (QUALITY_RANK[signal.quality] ?? 0) >= (QUALITY_RANK[notifyConfig.minQuality] ?? 0);
    return confidenceOk && qualityOk;
}

export function formatSignalMessage(signal, symbol) {
    const emoji = signal.type === "BUY" ? "🟢" : "🔴";
    const rr = signal.risk?.rrLabel ? `\nR:R  ${signal.risk.rrLabel}` : "";
    const sl = signal.risk?.stopLoss ? `\nStop  ${round(signal.risk.stopLoss)}` : "";
    const tp = signal.risk?.takeProfit ? `\nTarget  ${round(signal.risk.takeProfit)}` : "";

    return (
        `${emoji} *${signal.type} ${symbol}*\n` +
        `Strategy: ${signal.strategy}\n` +
        `Confidence: ${signal.confidence} (${signal.quality})\n` +
        `Entry  ${round(signal.price)}${sl}${tp}${rr}\n\n` +
        `${signal.reason}\n\n` +
        `_Added to the log — no action needed, review at your own pace._`
    );
}

export function formatDailySummaryMessage(data) {
    const pf = data.profitFactor === Infinity ? "∞" : data.profitFactor.toFixed(2);
    const best = data.bestStrategy ? `${data.bestStrategy.key} (${data.bestStrategy.winRate.toFixed(0)}%)` : "—";
    const worst = data.worstStrategy ? `${data.worstStrategy.key} (${data.worstStrategy.winRate.toFixed(0)}%)` : "—";

    return (
        `📊 *Daily Report — ${data.dateLabel}*\n\n` +
        `Trades: ${data.totalTrades}  |  Win rate: ${data.winRate.toFixed(1)}%\n` +
        `Total P/L: ${data.totalPnlPct >= 0 ? "+" : ""}${data.totalPnlPct.toFixed(2)}%  |  Profit factor: ${pf}\n` +
        `Best: ${best}\n` +
        `Worst: ${worst}\n` +
        `Still open: ${data.openCount}\n\n` +
        `Full report saved locally with per-trade reasoning.`
    );
}

function round(n) {
    return Number.isFinite(n) ? Number(n.toFixed(4)) : n;
}
FILEEOF

# --- 4. config.js: add notifications block (preserve existing symbols/settings if already customized) ---
python3 << 'PYEOF'
import re

path = "scripts/scheduler/config.js"
with open(path) as f:
    content = f.read()

if "notifications:" not in content:
    marker = "dailyReportMinute: 0,"
    assert marker in content, "Expected marker not found in config.js - aborting to avoid a bad edit"
    replacement = marker + """

    // Telegram push notifications - see notify.js header for one-time bot
    // setup steps. Needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in
    // frontend/.env; scheduler runs fine without them, it just skips
    // sending and logs a warning once.
    notifications: {
        enabled: true,
        // Only signals meeting BOTH thresholds get pushed - everything
        // still gets logged to SQLite and shows up in the daily report
        // regardless of this setting.
        minConfidence: 75,
        minQuality: "Medium", // "Low" | "Medium" | "High"
        // Also push a short daily summary when the HTML report generates.
        dailySummary: true
    },"""
    content = content.replace(marker, replacement, 1)
    with open(path, "w") as f:
        f.write(content)
    print("Added notifications block to config.js")
else:
    print("config.js already has a notifications block, leaving it alone.")
PYEOF

# --- 5. generateReport.js: return data alongside filepath (needed for Telegram daily summary) ---
python3 << 'PYEOF'
path = "scripts/scheduler/generateReport.js"
with open(path) as f:
    content = f.read()

if "return { filepath, data }" not in content:
    old = "    return filepath;"
    assert old in content, "Expected 'return filepath;' not found in generateReport.js - aborting"
    content = content.replace(old, "    return { filepath, data };", 1)
    with open(path, "w") as f:
        f.write(content)
    print("Updated generateReport.js to return { filepath, data }")
else:
    print("generateReport.js already returns { filepath, data }, leaving it alone.")
PYEOF

# --- 5b. cli-report.js: destructure the new return shape ---
python3 << 'PYEOF'
path = "scripts/scheduler/cli-report.js"
with open(path) as f:
    content = f.read()

old = "const filepath = generateReport();"
if old in content:
    content = content.replace(old, "const { filepath } = generateReport();", 1)
    with open(path, "w") as f:
        f.write(content)
    print("Updated cli-report.js to destructure { filepath }")
else:
    print("cli-report.js already destructures the new shape, leaving it alone.")
PYEOF

# --- 6. runScheduler.js: add dotenv import + notify wiring (only if not already present) ---
python3 << 'PYEOF'
import re

path = "scripts/scheduler/runScheduler.js"
with open(path) as f:
    content = f.read()

changed = False

if 'import "dotenv/config"' not in content:
    assert content.startswith("//"), "Expected file to start with a comment header - aborting"
    # Insert dotenv import right after the header comment block, before the first real import
    idx = content.index("import cron from")
    content = content[:idx] + 'import "dotenv/config";\n' + content[idx:]
    changed = True

if "sendTelegramMessage" not in content:
    old_import = 'import { generateReport } from "./generateReport.js";'
    assert old_import in content, "Expected generateReport import not found - aborting"
    new_import = old_import + '\nimport { sendTelegramMessage, meetsNotifyThreshold, formatSignalMessage, formatDailySummaryMessage } from "./notify.js";'
    content = content.replace(old_import, new_import, 1)

    old_log = '''        console.log(
            `[${symbol}] opened ${signal.strategy} #${id}: ${signal.type} @ ${signal.price} ` +
            `(confidence ${signal.confidence}, ${signal.quality})`
        );'''
    assert old_log in content, "Expected opened-signal log line not found - aborting"
    new_log = old_log + '''

        if (meetsNotifyThreshold(signal, config.notifications)) {
            sendTelegramMessage(formatSignalMessage(signal, symbol));
        }'''
    content = content.replace(old_log, new_log, 1)

    old_report_block = '''            const filepath = generateReport();
            console.log(`Report written to ${filepath}`);'''
    new_report_block = '''            const { filepath, data } = generateReport();
            console.log(`Report written to ${filepath}`);
            if (config.notifications?.enabled && config.notifications?.dailySummary) {
                sendTelegramMessage(formatDailySummaryMessage(data));
            }'''
    assert old_report_block in content, "Expected report block not found in runScheduler.js - aborting"
    content = content.replace(old_report_block, new_report_block, 1)
    changed = True

if changed:
    with open(path, "w") as f:
        f.write(content)
    print("Updated runScheduler.js (dotenv import + Telegram wiring)")
else:
    print("runScheduler.js already wired for Telegram, leaving it alone.")
PYEOF

# --- 6. cli-report.js: needs dotenv too, since it also reads .env-derived config ---
python3 << 'PYEOF'
path = "scripts/scheduler/cli-report.js"
with open(path) as f:
    content = f.read()

if 'import "dotenv/config"' not in content:
    content = 'import "dotenv/config";\n' + content
    with open(path, "w") as f:
        f.write(content)
    print("Added dotenv import to cli-report.js")
else:
    print("cli-report.js already has dotenv import.")
PYEOF

echo ""
echo "Done. Summary:"
echo "  - frontend/.env cleaned up + plain TWELVEDATA_API_KEY added (backup at .env.bak)"
echo "  - dotenv installed and loaded in runScheduler.js + cli-report.js"
echo "  - notify.js created, config.js/runScheduler.js wired for Telegram"
echo ""
echo "Restart the running service so it picks up the changes:"
echo "  launchctl unload ~/Library/LaunchAgents/com.otcsignal.scheduler.plist"
echo "  launchctl load ~/Library/LaunchAgents/com.otcsignal.scheduler.plist"
echo ""
echo "Then confirm Telegram works:"
echo "  tail -f frontend/data/scheduler.log"
echo "  (wait for a signal, or lower minConfidence in config.js temporarily to force one)"
