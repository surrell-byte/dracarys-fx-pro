// Discord webhook push notifications for high-confidence signals + the
// daily report summary. Isolated here so a notification failure (bad
// webhook URL, network hiccup, Discord down) never takes down the
// scheduler - every send is wrapped and just logs a warning on failure.
//
// Setup (one-time):
//   1. In Discord: channel settings -> Integrations -> Webhooks -> New Webhook.
//   2. Copy the Webhook URL.
//   3. Put it in frontend/.env:
//        DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/.../...

let warnedMissingDiscordConfig = false;

export async function sendDiscordMessage(text) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
        if (!warnedMissingDiscordConfig) {
            console.warn(
                "Discord notifications requested but DISCORD_WEBHOOK_URL isn't " +
                "set in frontend/.env - skipping (see notify.js header for setup steps)."
            );
            warnedMissingDiscordConfig = true;
        }
        return false;
    }

    try {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Discord uses plain "content", not Telegram's parse_mode/Markdown flag -
            // basic markdown (*, _, etc.) still renders the same way though.
            body: JSON.stringify({ content: text })
        });
        if (!res.ok) {
            const body = await res.text();
            console.warn(`Discord send failed (${res.status}): ${body}`);
            return false;
        }
        return true;
    } catch (err) {
        console.warn("Discord send failed:", err.message);
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
    const expiry = signal.expiry?.label ? `\nSuggested expiry  ${signal.expiry.label}` : "";

    return (
        `${emoji} *${signal.type} ${symbol}*\n` +
        `Strategy: ${signal.strategy}\n` +
        `Confidence: ${signal.confidence} (${signal.quality})\n` +
        `Entry  ${round(signal.price)}${sl}${tp}${rr}${expiry}\n\n` +
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
