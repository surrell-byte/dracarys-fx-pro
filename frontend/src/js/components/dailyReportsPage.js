import demo from "@demo/demoAccount.js";

const page = document.querySelector("#page-daily-reports");

const API_ROUTE = "/api/report-history?route=reports/daily&limit=30";

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function startOfDay(timestamp) {
    const d = new Date(Number(timestamp));
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function computeProfitFactor(trades) {
    const grossWin = trades.filter(t => (t.pnl ?? 0) > 0).reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const grossLoss = Math.abs(trades.filter(t => (t.pnl ?? 0) < 0).reduce((sum, t) => sum + (t.pnl ?? 0), 0));
    if (grossLoss > 0) return grossWin / grossLoss;
    if (grossWin > 0) return Infinity;
    return 0;
}

function buildDailyFallback() {
    const closedTrades = demo.get().closedTrades || [];
    const days = new Map();

    for (const trade of closedTrades) {
        if (!trade.closedAt) continue;
        const dayStart = startOfDay(trade.closedAt);
        const bucket = days.get(dayStart) ?? { dayStart, label: formatDate(dayStart), totalTrades: 0, wins: 0, losses: 0, totalPnlPct: 0, trades: [] };
        bucket.totalTrades += 1;
        bucket.wins += (trade.pnl ?? 0) >= 0 ? 1 : 0;
        bucket.losses += (trade.pnl ?? 0) < 0 ? 1 : 0;
        bucket.totalPnlPct += Number.isFinite(trade.pnl) ? trade.pnl : 0;
        bucket.trades.push(trade);
        days.set(dayStart, bucket);
    }

    return Array.from(days.values())
        .sort((a, b) => b.dayStart - a.dayStart)
        .map((bucket) => ({
            dateLabel: bucket.label,
            period_start: bucket.label,
            totalTrades: bucket.totalTrades,
            winRate: bucket.totalTrades ? (bucket.wins / bucket.totalTrades) * 100 : 0,
            totalPnlPct: bucket.totalPnlPct,
            profitFactor: computeProfitFactor(bucket.trades),
            generatedAt: Date.now()
        }));
}

function escapeHtmlDaily(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

async function fetchReports() {
    const response = await fetch(API_ROUTE, { cache: "no-store" });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to load daily reports.");
    }
    const payload = await response.json();
    return Array.isArray(payload.reports) ? payload.reports : [];
}

function renderSummary(summaryEl, reports, isFallback = false) {
    if (!summaryEl) return;
    const totalReports = reports.length;
    const totalTrades = reports.reduce((sum, rpt) => sum + ((rpt.data?.totalTrades ?? rpt.totalTrades) || 0), 0);
    const netPnl = reports.reduce((sum, rpt) => sum + ((rpt.data?.totalPnlPct ?? rpt.totalPnlPct) || 0), 0);
    const avgWinRate = totalReports
        ? reports.reduce((sum, rpt) => sum + ((rpt.data?.winRate ?? rpt.winRate) || 0), 0) / totalReports
        : 0;

    const metrics = [
        ["Reports", totalReports],
        ["Total trades", totalTrades],
        ["Avg win rate", `${avgWinRate.toFixed(1)}%`],
        ["Cumulative P/L", `${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}%`]
    ];

    let html = metrics.map(([label, value]) => `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("");
    if (isFallback) {
        html += `<div class="metric subtle"><div class="label">Fallback</div><div class="value">Using local demo trade summary</div></div>`;
    }
    summaryEl.innerHTML = html;
}

function renderTable(bodyEl, reports) {
    if (!bodyEl) return;
    if (!reports.length) {
        bodyEl.innerHTML = `<tr><td colspan="6" class="empty-history">No daily reports available yet.</td></tr>`;
        return;
    }

    bodyEl.innerHTML = reports.map((report) => {
        const data = report.data ?? report;
        const winRate = Number.isFinite(data.winRate) ? `${data.winRate.toFixed(1)}%` : "—";
        const pnl = Number.isFinite(data.totalPnlPct) ? `${data.totalPnlPct >= 0 ? "+" : ""}${data.totalPnlPct.toFixed(2)}%` : "—";
        const profitFactor = Number.isFinite(data.profitFactor) ? (data.profitFactor === Infinity ? "∞" : data.profitFactor.toFixed(2)) : "—";
        return `
            <tr>
                <td>${escapeHtml(data.dateLabel ?? report.period_start)}</td>
                <td>${data.totalTrades ?? 0}</td>
                <td>${winRate}</td>
                <td class="${data.totalPnlPct >= 0 ? "gain" : "loss"}">${pnl}</td>
                <td>${profitFactor}</td>
                <td>${formatDate(report.generated_at ?? report.generatedAt)}</td>
            </tr>`;
    }).join("");
}

async function render() {
    if (!page) return;
    const summaryEl = page.querySelector("#dailyReportsSummary");
    const bodyEl = page.querySelector("#dailyReportsBody");
    if (!summaryEl || !bodyEl) return;

    summaryEl.innerHTML = "Loading reports...";
    bodyEl.innerHTML = `<tr><td colspan="6" class="empty-history">Loading daily reports…</td></tr>`;

    try {
        const reports = await fetchReports();
        renderSummary(summaryEl, reports);
        renderTable(bodyEl, reports);
    } catch (error) {
        const fallbackReports = buildDailyFallback();
        if (fallbackReports.length) {
            renderSummary(summaryEl, fallbackReports, true);
            renderTable(bodyEl, fallbackReports);
        } else {
            summaryEl.innerHTML = "";
            bodyEl.innerHTML = `<tr><td colspan="6" class="empty-history">${escapeHtmlDaily(error.message)}</td></tr>`;
        }
    }
}

if (page) {
    render();
    document.querySelector("#sideMenu")?.addEventListener("click", (e) => {
        if (e.target.closest('[data-target="page-daily-reports"]')) render();
    });
}
