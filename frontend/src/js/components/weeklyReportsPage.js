import demo from "@demo/demoAccount.js";

const page = document.querySelector("#page-weekly-reports");

function startOfWeek(timestamp) {
    const d = new Date(timestamp);
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + diffToMonday);
    return d.getTime();
}

function formatWeekLabel(weekStartMs) {
    const start = new Date(weekStartMs);
    const end = new Date(weekStartMs + 6 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(start)} – ${fmt(end)}`;
}

function groupByWeek(trades) {
    const weeks = new Map();
    trades.forEach((t) => {
        if (!Number.isFinite(t.closedAt)) return;
        const weekStart = startOfWeek(t.closedAt);
        if (!weeks.has(weekStart)) {
            weeks.set(weekStart, { weekStart, trades: [], wins: 0, losses: 0, netPnl: 0 });
        }
        const bucket = weeks.get(weekStart);
        bucket.trades.push(t);
        if (t.pnl >= 0) bucket.wins += 1; else bucket.losses += 1;
        bucket.netPnl += Number(t.pnl) || 0;
    });
    return Array.from(weeks.values()).sort((a, b) => b.weekStart - a.weekStart);
}

function render() {
    if (!page) return;
    const summaryEl = page.querySelector("#weeklyReportsSummary");
    const bodyEl = page.querySelector("#weeklyReportsBody");
    if (!summaryEl || !bodyEl) return;

    const closedTrades = demo.get().closedTrades || [];
    const weeks = groupByWeek(closedTrades).slice(0, 8);

    if (!weeks.length) {
        bodyEl.innerHTML = `<tr><td colspan="6" class="empty-history">No closed demo trades yet — close a trade to see weekly numbers here.</td></tr>`;
        summaryEl.innerHTML = "";
        return;
    }

    const totalTrades = weeks.reduce((sum, w) => sum + w.trades.length, 0);
    const totalWins = weeks.reduce((sum, w) => sum + w.wins, 0);
    const totalNet = weeks.reduce((sum, w) => sum + w.netPnl, 0);
    const winRate = totalTrades ? ((totalWins / totalTrades) * 100).toFixed(1) : "0.0";

    summaryEl.innerHTML = [
        ["Weeks shown", weeks.length],
        ["Total trades", totalTrades],
        ["Win rate", `${winRate}%`],
        ["Net P/L (8wk)", `${totalNet >= 0 ? "+" : ""}${totalNet.toFixed(2)}`]
    ].map(([label, value]) => `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("");

    bodyEl.innerHTML = weeks.map((w) => {
        const rate = w.trades.length ? ((w.wins / w.trades.length) * 100).toFixed(1) : "0.0";
        const pnlClass = w.netPnl >= 0 ? "gain" : "loss";
        return `
            <tr>
                <td>${formatWeekLabel(w.weekStart)}</td>
                <td>${w.trades.length}</td>
                <td>${w.wins}</td>
                <td>${w.losses}</td>
                <td>${rate}%</td>
                <td data-pnl="${pnlClass}">${w.netPnl >= 0 ? "+" : ""}${w.netPnl.toFixed(2)}</td>
            </tr>
        `;
    }).join("");
}

if (page) {
    render();
    demo.subscribe(render);
    document.querySelector("#sideMenu")?.addEventListener("click", (e) => {
        if (e.target.closest('[data-target="page-weekly-reports"]')) render();
    });
}
