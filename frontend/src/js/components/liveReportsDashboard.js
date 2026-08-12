const REFRESH_MS = 60_000;
const page = document.querySelector("#page-live-reports");

if (page) {
    const status = page.querySelector("[data-live-status]");
    const summary = page.querySelector("[data-live-summary]");
    const insights = page.querySelector("[data-live-insights]");
    const trades = page.querySelector("[data-live-trades]");
    const signals = page.querySelector("[data-live-signals]");
    const dailyReports = page.querySelector("[data-live-daily-reports]");
    const weeklyReports = page.querySelector("[data-live-weekly-reports]");

    const load = async () => {
        try {
            // limit=3650 pulls the full history since the scheduler started
            // (see db.js getReportSnapshots) rather than just the last week.
            const [response, dailyResponse, weeklyResponse] = await Promise.all([
                fetch("/api/live-reports", { cache: "no-store" }),
                fetch("/api/report-history?route=reports/daily&limit=3650", { cache: "no-store" }),
                fetch("/api/report-history?route=reports/weekly&limit=3650", { cache: "no-store" })
            ]);
            const [data, daily, weekly] = await Promise.all([response.json(), dailyResponse.json(), weeklyResponse.json()]);
            if (!response.ok) throw new Error(data.error || "Unable to load live reports.");
            render(data);
            renderSnapshots(dailyReports, daily.reports || []);
            renderSnapshots(weeklyReports, weekly.reports || []);
            status.textContent = `Live · updated ${new Date(data.generatedAt || Date.now()).toLocaleTimeString()}`;
        } catch (error) {
            status.textContent = error.message || "Unable to load live reports.";
        }
    };

    function render(data) {
        const pct = (value, digits = 1) => Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
        const signed = value => `${Number(value) >= 0 ? "+" : ""}${pct(value, 2)}%`;
        const trend = value => Number(value) >= 0 ? "edge-positive" : "edge-negative";
        summary.innerHTML = [
            ["Win rate", `${pct(data.winRate)}%`],
            ["Today's P/L", signed(data.totalPnlPct), trend(data.totalPnlPct)],
            ["Closed trades", data.totalTrades ?? 0],
            ["Open signals", data.openCount ?? 0],
            ["Profit factor", data.profitFactor === Infinity ? "∞" : pct(data.profitFactor, 2)]
        ].map(([label, value, className = ""]) => `<div class="metric"><div class="label">${label}</div><div class="value ${className}">${value}</div></div>`).join("");

        insights.innerHTML = (data.insights || []).map(item => `<li>${escapeHtmlLiveReports(item)}</li>`).join("") || "<li>No insights available yet.</li>";
        trades.innerHTML = table(data.allClosedTrades || [], true);
        signals.innerHTML = table(data.openHighConfidence || [], false);
    }

    function renderSnapshots(container, reports) {
        if (!reports.length) {
            container.innerHTML = '<p class="muted">Reports are saved after the first scheduled run.</p>';
            return;
        }
        const count = `<p class="muted">${reports.length} report${reports.length === 1 ? "" : "s"} since tracking started</p>`;
        const list = reports.map(report => {
            const data = report.data || {};
            return `<div class="saved-report"><strong>${escapeHtmlLiveReports(data.dateLabel || report.period_start)}</strong><span>${data.totalTrades ?? 0} trades · ${Number(data.winRate ?? 0).toFixed(1)}% win rate · ${Number(data.totalPnlPct ?? 0) >= 0 ? "+" : ""}${Number(data.totalPnlPct ?? 0).toFixed(2)}%</span></div>`;
        }).join("");
        container.innerHTML = `${count}<div class="saved-report-list">${list}</div>`;
    }

    function formatTime(value) {
        const date = new Date(value);
        return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function escapeHtmlLiveReports(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    function table(rows, closed) {
        if (!rows.length) return '<p class="muted">Nothing to show yet.</p>';
        return `<table class="live-reports-table"><thead><tr><th>Pair</th><th>Direction</th><th>Confidence</th><th>${closed ? "Result" : "Entry"}</th><th>${closed ? "P/L" : "Expires"}</th><th>Time</th></tr></thead><tbody>${rows.slice(0, 20).map(row => `<tr><td>${escapeHtmlLiveReports(row.symbol)}</td><td><span class="badge ${row.type === "BUY" ? "green" : "red"}">${escapeHtmlLiveReports(row.type)}</span></td><td>${escapeHtmlLiveReports(row.confidence ?? "—")}</td><td>${closed ? escapeHtmlLiveReports(row.outcome ?? "—") : escapeHtmlLiveReports(row.entry_price ?? "—")}</td><td class="${closed ? (Number(row.pnl_pct) >= 0 ? "edge-positive" : "edge-negative") : ""}">${closed ? `${Number(row.pnl_pct) >= 0 ? "+" : ""}${Number(row.pnl_pct ?? 0).toFixed(2)}%` : escapeHtmlLiveReports(row.expiry_label ?? "—")}</td><td>${formatTime(closed ? row.closed_at : row.created_at)}</td></tr>`).join("")}</tbody></table>`;
    }

    load();
    setInterval(load, REFRESH_MS);
}
