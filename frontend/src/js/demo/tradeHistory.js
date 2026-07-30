// tradeHistory.js: read/render layer over demoAccount's closedTrades.
// tradeEngine.js is the only writer (via recordClosedTrade, called right
// after it pushes onto acc.closedTrades) — this module doesn't duplicate
// storage, it just formats what's already there.

import demo from "./demoAccount.js";

// Currently a no-op hook: closedTrades already lives on the account object
// and tradeEngine pushes onto it directly. Kept as a named entry point so
// history recording has one obvious place to extend (e.g. server sync,
// CSV export queue) without touching tradeEngine.js.
export function recordClosedTrade(_trade) {}

export function getHistory(limit = 50) {
    return demo.get().closedTrades.slice(0, limit);
}

export function clearHistory() {
    demo.get().closedTrades = [];
    demo.save();
}

function formatPrice(value) {
    if (!Number.isFinite(value)) return "--";
    return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 2 : 6 });
}

export function renderHistoryTable(container, limit = 40) {
    if (!container) return;
    const trades = getHistory(limit);

    if (!trades.length) {
        container.innerHTML = `<div class="empty-history">No closed demo trades yet</div>`;
        return;
    }

    container.innerHTML = trades.map((t) => `
        <div class="history-row demo-history-row">
            <time>${new Date(t.closedAt).toLocaleTimeString()}</time>
            <strong data-signal="${t.side === "long" ? "buy" : "sell"}">${t.side === "long" ? "BUY" : "SELL"}</strong>
            <span data-pnl="${t.pnl >= 0 ? "gain" : "loss"}">${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</span>
            <span>${formatPrice(t.exitPrice)}</span>
            <small>${t.strategy} · ${t.exitReason || "closed"}</small>
        </div>
    `).join("");
}
