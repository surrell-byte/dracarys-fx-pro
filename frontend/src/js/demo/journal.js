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

export function buildJournalEntriesFromSignals(rows = []) {
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => {
        const pnl = Number(row.pnl_pct ?? row.pnl ?? 0);
        const strategy = row.strategy_label || row.strategy_id || row.strategy || "Signal Strategy";
        const symbol = String(row.symbol || "FX");
        const side = String(row.type || "BUY").toUpperCase();
        const sign = pnl >= 0 ? "gain" : "loss";
        const outcome = String(row.outcome || (pnl >= 0 ? "win" : "loss")).toLowerCase();
        const closedAt = row.closed_at || row.closedAt || new Date().toISOString();
        const confidence = Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null;
        const confidenceText = confidence !== null ? `${Math.round(confidence)}% confidence` : "no confidence score";
        const closeReason = row.close_reason || row.exitReason || row.reason || "Closed by the scheduler.";
        const sideLabel = side === "SELL" ? "short" : side === "BUY" ? "long" : String(side).toLowerCase();
        const pnlText = `${pnl >= 0 ? "+" : ""}${Number.isFinite(pnl) ? pnl.toFixed(2) : "0.00"}%`;
        const outcomeBadge = outcome === "win" ? "WIN" : "LOSS";
        const outcomeWord = outcome === "win" ? "Win" : "Loss";
        const note = `${outcomeBadge} on ${strategy} — went ${sideLabel} in ${symbol} (${confidenceText}), closed ${closeReason}, and ${outcome === "win" ? "booked" : "reported"} ${pnlText}. ${row.reason || "Review the setup and learn from the exit."}`;
        const plainNote = `${outcomeWord} on ${strategy} — went ${sideLabel} in ${symbol} (${confidenceText}), closed ${closeReason}, and ${outcome === "win" ? "booked" : "reported"} ${pnlText}. ${row.reason || "Review the setup and learn from the exit."}`;

        return {
            symbol,
            strategy,
            strategyId: row.strategy_id || strategy,
            side,
            pnl,
            confidence,
            entryPrice: Number(row.entry_price ?? row.entryPrice ?? 0),
            exitPrice: Number(row.exit_price ?? row.exitPrice ?? 0),
            exitReason: closeReason,
            closedAt,
            outcome,
            note,
            plainNote,
            outcomeBadge,
            pnlLabel: sign,
            closedAtMs: new Date(closedAt).valueOf()
        };
    });
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
