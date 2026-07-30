// journal.js: the "not just a fake balance" part. Every closed trade gets a
// plain-English note (strategy, confidence, entry/exit, why it closed) so
// the Demo Account reads like an actual trading journal, not just a number
// ticking up or down.

import demo from "./demoAccount.js";

const MAX_ENTRIES = 300;

function formatPrice(value) {
    if (!Number.isFinite(value)) return "--";
    return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 2 : 6 });
}

function buildNote(trade) {
    const outcome = trade.pnl >= 0 ? "Win" : "Loss";
    const confidenceText = Number.isFinite(trade.confidence)
        ? `${trade.confidence}% confidence`
        : "no confidence score";
    const sideLabel = trade.side === "long" ? "long" : "short";
    return `${outcome} on ${trade.strategy} — went ${sideLabel} at ${formatPrice(trade.entryPrice)} `
        + `(${confidenceText}), exited at ${formatPrice(trade.exitPrice)} `
        + `for ${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}. `
        + `${trade.exitReason || "Manually closed."}`;
}

// Called by tradeEngine right after a trade closes.
export function addJournalEntry(trade) {
    const acc = demo.get();
    acc.journal = acc.journal || [];
    acc.journal.unshift({ ...trade, note: buildNote(trade) });
    acc.journal = acc.journal.slice(0, MAX_ENTRIES);
    demo.save();
}

export function getJournal(limit = 50) {
    return (demo.get().journal || []).slice(0, limit);
}

export function clearJournal() {
    demo.get().journal = [];
    demo.save();
}

export function renderJournal(container, limit = 50) {
    if (!container) return;
    const entries = getJournal(limit);

    if (!entries.length) {
        container.innerHTML = `<div class="empty-history">No journal entries yet — close a trade to see it here.</div>`;
        return;
    }

    container.innerHTML = entries.map((e) => `
        <div class="journal-entry ${e.pnl >= 0 ? "journal-win" : "journal-loss"}">
            <div class="journal-entry-head">
                <span class="journal-badge">${e.pnl >= 0 ? "WIN" : "LOSS"}</span>
                <span class="journal-symbol">${(e.symbol || "").toUpperCase()}</span>
                <span class="journal-pnl" data-pnl="${e.pnl >= 0 ? "gain" : "loss"}">${e.pnl >= 0 ? "+" : ""}${e.pnl.toFixed(2)}</span>
                <time>${new Date(e.closedAt).toLocaleString()}</time>
            </div>
            <p class="journal-note">${e.note}</p>
        </div>
    `).join("");
}
