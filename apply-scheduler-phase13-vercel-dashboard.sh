#!/usr/bin/env bash
set -euo pipefail

INDEX_HTML="frontend/index.html"
COMPONENT_DIR="frontend/src/js/components"
COMPONENT_FILE="${COMPONENT_DIR}/liveReportsDashboard.js"
ENV_EXAMPLE="frontend/.env.example"

if [ ! -f "$INDEX_HTML" ]; then
    echo "ERROR: $INDEX_HTML not found. Run this from your project root."
    exit 1
fi

cp "$INDEX_HTML" "${INDEX_HTML}.bak"
echo "Backed up index.html (.bak)"

# ---------------------------------------------------------------------------
# 1. Add sidebar button + page container
# ---------------------------------------------------------------------------
python3 - "$INDEX_HTML" << 'PYEOF'
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old_button = '<button type="button" data-target="page-history"><span class="menu-icon">📚</span><span class="menu-label">Trade History</span></button>'
new_button = (
    old_button + "\n"
    '                <button type="button" data-target="page-live-reports">'
    '<span class="menu-icon">🌐</span><span class="menu-label">Live Reports</span></button>'
)
if old_button not in src:
    print("ERROR: expected Trade History sidebar button not found - no changes made.")
    sys.exit(1)
src = src.replace(old_button, new_button, 1)

old_page_marker = '<div class="page" id="page-history">'
if old_page_marker not in src:
    print("ERROR: expected page-history div not found - no changes made.")
    sys.exit(1)

# Insert the new page div right before page-history's closing point is
# hard to find generically, so instead insert a full new page block right
# before the closing </main> - simplest reliable anchor.
old_main_close = '''            </main>
        </div>
    </div>'''
new_page_html = '''            <div class="page" id="page-live-reports">
                <section class="panel">
                    <h2>Live Reports <span class="muted" style="font-weight:400;font-size:13px;">— pulled from your 24/7 scheduler</span></h2>
                    <div id="liveReportsStatus" class="muted">Loading…</div>
                    <div id="liveReportsStatStrip" class="stat-strip" style="margin-top:16px;"></div>
                    <div id="liveReportsInsights" style="margin-top:20px;"></div>
                    <div id="liveReportsTrades" style="margin-top:20px;overflow-x:auto;"></div>
                </section>
            </div>

            </main>
        </div>
    </div>'''
if old_main_close not in src:
    print("ERROR: expected </main> closing block not found - no changes made.")
    sys.exit(1)
src = src.replace(old_main_close, new_page_html, 1)

old_scripts = '<script type="module" src="src/js/core/presentationMode.js"></script>'
new_scripts = old_scripts + '\n    <script type="module" src="src/js/components/liveReportsDashboard.js"></script>'
if old_scripts not in src:
    print("ERROR: expected presentationMode.js script tag not found - no changes made.")
    sys.exit(1)
src = src.replace(old_scripts, new_scripts, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("index.html: added Live Reports sidebar entry, page container, and script tag")
PYEOF

# ---------------------------------------------------------------------------
# 2. The dashboard module itself - fetches from the GCP API, renders using
#    existing .panel/.stat-strip/.metric/.badge classes. Fully standalone:
#    doesn't touch or depend on app.js's internal state, so it can't
#    regress anything already working.
# ---------------------------------------------------------------------------
mkdir -p "$COMPONENT_DIR"
cat > "$COMPONENT_FILE" << 'JSEOF'
// Fetches live trading data from the GCP-hosted reports API and renders it
// into the "Live Reports" page. Fully standalone - reads only its own DOM
// elements (all under #page-live-reports), touches nothing app.js owns.
//
// Configure via a .env value baked in at build time (Vite exposes
// VITE_-prefixed vars on import.meta.env): set VITE_REPORTS_API_URL and
// VITE_REPORTS_USER / VITE_REPORTS_PASSWORD in your Vercel project's
// environment variables (Vercel dashboard -> Settings -> Environment
// Variables), matching whatever you set on the GCP server's .env.
//
// Known limitation, stated plainly: these credentials end up visible in
// the browser's network tab (Basic Auth over fetch always works this
// way) - this is fine for a personal single-user tool behind your own
// server, but don't treat it as strong security. If you ever want this
// properly locked down, the fix is a server-side proxy route instead of
// calling the GCP API directly from the browser.

const API_URL = import.meta.env.VITE_REPORTS_API_URL;
const API_USER = import.meta.env.VITE_REPORTS_USER;
const API_PASSWORD = import.meta.env.VITE_REPORTS_PASSWORD;

const REFRESH_MS = 60_000; // matches the scheduler's own poll cadence

const statusEl = document.querySelector("#liveReportsStatus");
const statStripEl = document.querySelector("#liveReportsStatStrip");
const insightsEl = document.querySelector("#liveReportsInsights");
const tradesEl = document.querySelector("#liveReportsTrades");

// If this page was never added (older cached HTML, etc.) just bail quietly.
if (statusEl && statStripEl && insightsEl && tradesEl) {
    if (!API_URL || !API_USER || !API_PASSWORD) {
        statusEl.textContent =
            "Not configured yet - set VITE_REPORTS_API_URL, VITE_REPORTS_USER, " +
            "and VITE_REPORTS_PASSWORD in your Vercel project's environment variables.";
    } else {
        loadLiveData();
        setInterval(loadLiveData, REFRESH_MS);
    }
}

async function loadLiveData() {
    try {
        const auth = btoa(`${API_USER}:${API_PASSWORD}`);
        const res = await fetch(API_URL, {
            headers: { Authorization: `Basic ${auth}` }
        });
        if (!res.ok) {
            statusEl.textContent = `Couldn't load live data (HTTP ${res.status}).`;
            return;
        }
        const data = await res.json();
        render(data);
        statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
        statusEl.textContent = "Couldn't reach the reports server. Is it running?";
    }
}

function render(data) {
    const pct = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : "-");
    const pnlClass = n => (n >= 0 ? "pos" : "neg");

    statStripEl.innerHTML = `
        <div class="metric"><div class="label">Closed Trades</div><div class="value">${data.totalTrades}</div></div>
        <div class="metric"><div class="label">Win Rate</div><div class="value">${pct(data.winRate)}%</div></div>
        <div class="metric"><div class="label">Total P/L</div><div class="value ${pnlClass(data.totalPnlPct)}">${data.totalPnlPct >= 0 ? "+" : ""}${pct(data.totalPnlPct)}%</div></div>
        <div class="metric"><div class="label">Still Open</div><div class="value">${data.openCount}</div></div>
    `;

    insightsEl.innerHTML = `
        <h3 style="font-size:13px;color:var(--amber);text-transform:uppercase;">Why — Key Takeaways</h3>
        <ul>${(data.insights || []).map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
    `;

    const trades = (data.allClosedTrades || []).slice(0, 20);
    tradesEl.innerHTML = trades.length
        ? `
        <h3 style="font-size:13px;color:var(--amber);text-transform:uppercase;">Recent Trades</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr>
                <th style="text-align:left;padding:6px;">Symbol</th>
                <th style="text-align:left;padding:6px;">Strategy</th>
                <th style="text-align:left;padding:6px;">Side</th>
                <th style="text-align:left;padding:6px;">Outcome</th>
                <th style="text-align:left;padding:6px;">P/L</th>
            </tr></thead>
            <tbody>${trades.map(t => `
                <tr>
                    <td style="padding:6px;">${escapeHtml(t.symbol)}</td>
                    <td style="padding:6px;">${escapeHtml(t.strategy_label)}</td>
                    <td style="padding:6px;"><span class="badge ${t.type === "BUY" ? "green" : "red"}">${t.type}</span></td>
                    <td style="padding:6px;">${escapeHtml(t.outcome ?? "-")}</td>
                    <td style="padding:6px;" class="${pnlClass(t.pnl_pct ?? 0)}">${(t.pnl_pct ?? 0) >= 0 ? "+" : ""}${pct(t.pnl_pct, 2)}%</td>
                </tr>`).join("")}
            </tbody>
        </table>`
        : `<div class="muted">No closed trades yet today.</div>`;
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}
JSEOF
echo "liveReportsDashboard.js: created"

# ---------------------------------------------------------------------------
# 3. Document the required Vercel env vars
# ---------------------------------------------------------------------------
if [ -f "$ENV_EXAMPLE" ] && ! grep -q "VITE_REPORTS_API_URL" "$ENV_EXAMPLE"; then
    cat >> "$ENV_EXAMPLE" << 'ENVEOF'

# Live Reports dashboard (frontend/src/js/components/liveReportsDashboard.js)
# Set these in Vercel's project settings (Settings -> Environment
# Variables), NOT in this local file - Vite only bakes VITE_-prefixed
# vars into the browser bundle at build time.
VITE_REPORTS_API_URL=https://YOUR-DOMAIN.nip.io/api/latest
VITE_REPORTS_USER=
VITE_REPORTS_PASSWORD=
ENVEOF
    echo ".env.example: documented VITE_REPORTS_API_URL / VITE_REPORTS_USER / VITE_REPORTS_PASSWORD"
fi

echo ""
if command -v node >/dev/null 2>&1; then
    node --check "$COMPONENT_FILE" && echo "Syntax check passed: $COMPONENT_FILE"
fi

echo ""
echo "Done. Phase 13 applied."
echo "Backup: ${INDEX_HTML}.bak"
echo ""
echo "Next steps:"
echo "1. In Vercel: Project Settings -> Environment Variables, add:"
echo "     VITE_REPORTS_API_URL = https://YOUR-DOMAIN.nip.io/api/latest"
echo "     VITE_REPORTS_USER    = (same as REPORTS_USER on the GCP server)"
echo "     VITE_REPORTS_PASSWORD = (same as REPORTS_PASSWORD on the GCP server)"
echo "2. Redeploy on Vercel (env var changes need a fresh deploy to take effect)"
echo "3. Preview locally first if you want:"
echo "     cd frontend && npm run dev"
echo "   (create a local .env.local with the same VITE_ vars for local preview)"
