// Pure functions: turn rows of closed/open signals into report data, then
// into an HTML string. No IO here - generateReport.js (the DB-touching,
// file-writing wrapper) is the only thing that calls fs or db.js. Keeping
// this side-effect-free means it can be tested with plain arrays.

export function buildReportData(closedRows, openRows, dateLabel) {
    const totalTrades = closedRows.length;
    const wins = closedRows.filter(r => r.outcome === "win").length;
    const losses = totalTrades - wins;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;

    const totalPnlPct = sum(closedRows.map(r => r.pnl_pct ?? 0));
    const avgPnlPct = totalTrades ? totalPnlPct / totalTrades : 0;

    const grossWin = sum(closedRows.filter(r => (r.pnl_pct ?? 0) > 0).map(r => r.pnl_pct));
    const grossLoss = Math.abs(sum(closedRows.filter(r => (r.pnl_pct ?? 0) < 0).map(r => r.pnl_pct)));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);

    const strategyLeaderboard = groupAndScore(closedRows, r => r.strategy_label);
    const symbolStats = groupAndScore(closedRows, r => r.symbol);

    const bestStrategy = strategyLeaderboard[0] ?? null;
    const worstStrategy = strategyLeaderboard.length ? strategyLeaderboard.at(-1) : null;
    const mostActiveSymbol = [...symbolStats].sort((a, b) => b.trades - a.trades)[0] ?? null;

    const topSignals = [...closedRows]
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .slice(0, 10);

    const openHighConfidence = [...openRows]
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .slice(0, 10);

    return {
        dateLabel,
        totalTrades,
        wins,
        losses,
        winRate,
        totalPnlPct,
        avgPnlPct,
        profitFactor,
        strategyLeaderboard,
        symbolStats,
        bestStrategy,
        worstStrategy,
        mostActiveSymbol,
        topSignals,
        openHighConfidence,
        openCount: openRows.length
    };
}

function groupAndScore(rows, keyFn) {
    const groups = new Map();
    for (const r of rows) {
        const key = keyFn(r) ?? "unknown";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    return [...groups.entries()]
        .map(([key, trades]) => {
            const wins = trades.filter(t => t.outcome === "win").length;
            const totalPnl = sum(trades.map(t => t.pnl_pct ?? 0));
            return {
                key,
                trades: trades.length,
                wins,
                losses: trades.length - wins,
                winRate: trades.length ? (wins / trades.length) * 100 : 0,
                totalPnl,
                avgPnl: trades.length ? totalPnl / trades.length : 0
            };
        })
        .sort((a, b) => b.totalPnl - a.totalPnl);
}

function sum(arr) {
    return arr.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

export function renderReportHtml(data) {
    const pct = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : "-");
    const pnlClass = n => (n >= 0 ? "pos" : "neg");

    const leaderboardRows = data.strategyLeaderboard.map(s => `
        <tr>
            <td>${escapeHtml(s.key)}</td>
            <td>${s.trades}</td>
            <td>${s.wins}/${s.losses}</td>
            <td>${pct(s.winRate)}%</td>
            <td class="${pnlClass(s.totalPnl)}">${s.totalPnl >= 0 ? "+" : ""}${pct(s.totalPnl)}%</td>
            <td class="${pnlClass(s.avgPnl)}">${s.avgPnl >= 0 ? "+" : ""}${pct(s.avgPnl, 2)}%</td>
        </tr>`).join("");

    const symbolRows = data.symbolStats.map(s => `
        <tr>
            <td>${escapeHtml(s.key)}</td>
            <td>${s.trades}</td>
            <td>${pct(s.winRate)}%</td>
            <td class="${pnlClass(s.totalPnl)}">${s.totalPnl >= 0 ? "+" : ""}${pct(s.totalPnl)}%</td>
        </tr>`).join("");

    const signalRows = data.topSignals.map(t => `
        <tr>
            <td>${formatTime(t.closed_at)}</td>
            <td>${escapeHtml(t.symbol)}</td>
            <td>${escapeHtml(t.strategy_label)}</td>
            <td><span class="badge ${t.type === "BUY" ? "buy" : "sell"}">${t.type}</span></td>
            <td>${t.confidence ?? "-"}</td>
            <td>${escapeHtml(t.expiry_label ?? "-")}</td>
            <td>${escapeHtml(t.outcome ?? "-")} <span class="muted">(${escapeHtml(t.close_reason ?? "-")})</span></td>
            <td class="${pnlClass(t.pnl_pct ?? 0)}">${(t.pnl_pct ?? 0) >= 0 ? "+" : ""}${pct(t.pnl_pct, 2)}%</td>
            <td class="reason">${escapeHtml(t.reason ?? "")}</td>
        </tr>`).join("");

    const openRows = data.openHighConfidence.map(t => `
        <tr>
            <td>${formatTime(t.created_at)}</td>
            <td>${escapeHtml(t.symbol)}</td>
            <td>${escapeHtml(t.strategy_label)}</td>
            <td><span class="badge ${t.type === "BUY" ? "buy" : "sell"}">${t.type}</span></td>
            <td>${t.confidence ?? "-"}</td>
            <td>${escapeHtml(t.expiry_label ?? "-")}</td>
            <td>${t.entry_price}</td>
            <td>${t.stop_loss ?? "-"}</td>
            <td>${t.take_profit ?? "-"}</td>
            <td class="reason">${escapeHtml(t.reason ?? "")}</td>
        </tr>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Dracarys FX Pro — Daily Report — ${escapeHtml(data.dateLabel)}</title>
<style>
    :root {
        --bg: #0d1117; --panel: #161b22; --border: #30363d; --text: #e6edf3;
        --muted: #8b949e; --pos: #3fb950; --neg: #f85149; --accent: #58a6ff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; background: var(--bg); color: var(--text);
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .subtitle { color: var(--muted); margin-bottom: 28px; font-size: 14px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px; margin-bottom: 28px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
        padding: 16px; }
    .card .label { color: var(--muted); font-size: 12px; text-transform: uppercase;
        letter-spacing: 0.05em; margin-bottom: 6px; }
    .card .value { font-size: 24px; font-weight: 600; }
    .pos { color: var(--pos); } .neg { color: var(--neg); }
    section { margin-bottom: 32px; }
    h2 { font-size: 15px; color: var(--accent); text-transform: uppercase;
        letter-spacing: 0.04em; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px;
        border-bottom: 1px solid var(--border); }
    td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge.buy { background: rgba(63,185,80,0.15); color: var(--pos); }
    .badge.sell { background: rgba(248,81,73,0.15); color: var(--neg); }
    .muted { color: var(--muted); }
    .reason { color: var(--muted); max-width: 320px; }
    .empty { color: var(--muted); font-style: italic; padding: 12px 0; }
</style>
</head>
<body>
    <h1>Dracarys FX Pro — Daily Report</h1>
    <div class="subtitle">${escapeHtml(data.dateLabel)} &middot; generated ${new Date().toLocaleString()}</div>

    <div class="cards">
        <div class="card"><div class="label">Closed Trades</div><div class="value">${data.totalTrades}</div></div>
        <div class="card"><div class="label">Win Rate</div><div class="value">${pct(data.winRate)}%</div></div>
        <div class="card"><div class="label">Wins / Losses</div><div class="value">${data.wins} / ${data.losses}</div></div>
        <div class="card"><div class="label">Total P/L</div><div class="value ${pnlClass(data.totalPnlPct)}">${data.totalPnlPct >= 0 ? "+" : ""}${pct(data.totalPnlPct)}%</div></div>
        <div class="card"><div class="label">Profit Factor</div><div class="value">${data.profitFactor === Infinity ? "∞" : pct(data.profitFactor, 2)}</div></div>
        <div class="card"><div class="label">Still Open</div><div class="value">${data.openCount}</div></div>
    </div>

    <section>
        <h2>Strategy Leaderboard</h2>
        ${data.strategyLeaderboard.length ? `
        <table>
            <thead><tr><th>Strategy</th><th>Trades</th><th>W/L</th><th>Win Rate</th><th>Total P/L</th><th>Avg P/L</th></tr></thead>
            <tbody>${leaderboardRows}</tbody>
        </table>` : `<div class="empty">No closed trades yet today.</div>`}
    </section>

    <section>
        <h2>By Symbol</h2>
        ${data.symbolStats.length ? `
        <table>
            <thead><tr><th>Symbol</th><th>Trades</th><th>Win Rate</th><th>Total P/L</th></tr></thead>
            <tbody>${symbolRows}</tbody>
        </table>` : `<div class="empty">No closed trades yet today.</div>`}
    </section>

    <section>
        <h2>Today's Trades (highest confidence first)</h2>
        ${data.topSignals.length ? `
        <table>
            <thead><tr><th>Closed</th><th>Symbol</th><th>Strategy</th><th>Side</th><th>Conf.</th><th>Expiry</th><th>Outcome</th><th>P/L</th><th>Reason</th></tr></thead>
            <tbody>${signalRows}</tbody>
        </table>` : `<div class="empty">No closed trades yet today.</div>`}
    </section>

    <section>
        <h2>Still Open — Highest Confidence</h2>
        ${data.openHighConfidence.length ? `
        <table>
            <thead><tr><th>Opened</th><th>Symbol</th><th>Strategy</th><th>Side</th><th>Conf.</th><th>Expiry</th><th>Entry</th><th>Stop</th><th>Target</th><th>Reason</th></tr></thead>
            <tbody>${openRows}</tbody>
        </table>` : `<div class="empty">Nothing open right now.</div>`}
    </section>
</body>
</html>`;
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function formatTime(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
