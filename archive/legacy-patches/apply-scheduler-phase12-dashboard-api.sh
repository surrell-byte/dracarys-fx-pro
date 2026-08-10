#!/usr/bin/env bash
set -euo pipefail

GEN_REPORT="frontend/scripts/scheduler/generateReport.js"
REPORT_SERVER="frontend/scripts/scheduler/reportServer.js"

for f in "$GEN_REPORT" "$REPORT_SERVER"; do
    if [ ! -f "$f" ]; then
        echo "ERROR: $f not found. Run this from your project root."
        exit 1
    fi
done

cp "$GEN_REPORT" "${GEN_REPORT}.bak"
cp "$REPORT_SERVER" "${REPORT_SERVER}.bak"
echo "Backed up generateReport.js, reportServer.js (.bak)"

# ---------------------------------------------------------------------------
# 1. generateReport.js: extract the DB-fetch + buildReportData logic into
#    its own export (getLiveReportData) so the JSON API can reuse it
#    without writing a report file to disk on every request.
# ---------------------------------------------------------------------------
python3 - "$GEN_REPORT" << 'PYEOF'
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''export function generateReport({ date = new Date() } = {}) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const closedRows = getClosedSignalsSince(startOfDay.toISOString());
    const openRows = getAllOpenSignals();

    const dateLabel = date.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    const data = buildReportData(closedRows, openRows, dateLabel);
    const html = renderReportHtml(data);

    fs.mkdirSync(config.reportsDir, { recursive: true });
    const filename = `report-${date.toISOString().slice(0, 10)}.html`;
    const filepath = path.join(config.reportsDir, filename);
    fs.writeFileSync(filepath, html);

    return { filepath, data };
}'''

new = '''// Just the data (no HTML render, no file write) - used by the JSON API
// endpoint so a dashboard can poll for live numbers without generating a
// report file on every request.
export function getLiveReportData({ date = new Date() } = {}) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const closedRows = getClosedSignalsSince(startOfDay.toISOString());
    const openRows = getAllOpenSignals();

    const dateLabel = date.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    return buildReportData(closedRows, openRows, dateLabel);
}

export function generateReport({ date = new Date() } = {}) {
    const data = getLiveReportData({ date });
    const html = renderReportHtml(data);

    fs.mkdirSync(config.reportsDir, { recursive: true });
    const filename = `report-${date.toISOString().slice(0, 10)}.html`;
    const filepath = path.join(config.reportsDir, filename);
    fs.writeFileSync(filepath, html);

    return { filepath, data };
}'''

if old not in src:
    print("ERROR: expected generateReport function body not found - no changes made.")
    sys.exit(1)

src = src.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("generateReport.js: added getLiveReportData export (data-only, no file write)")
PYEOF

# ---------------------------------------------------------------------------
# 2. reportServer.js: add GET /api/latest (JSON, CORS-enabled) alongside
#    the existing HTML report browsing. Same Basic Auth as everything else
#    on this server - the dashboard's fetch() call includes the
#    Authorization header itself (see the frontend dashboard script).
# ---------------------------------------------------------------------------
python3 - "$REPORT_SERVER" << 'PYEOF'
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old_import = 'import { config } from "./config.js";'
new_import = 'import { config } from "./config.js";\nimport { getLiveReportData } from "./generateReport.js";'
if old_import not in src:
    print("ERROR: expected config.js import line not found - no changes made.")
    sys.exit(1)
src = src.replace(old_import, new_import, 1)

# CORS_ORIGIN: which site is allowed to fetch this via JS. Defaults to "*"
# (any site) since this is a personal read-only endpoint behind Basic
# Auth anyway - set CORS_ORIGIN in .env to your exact Vercel URL if you
# want to lock it down tighter later.
old_const = 'const PASSWORD = process.env.REPORTS_PASSWORD;'
new_const = (
    'const PASSWORD = process.env.REPORTS_PASSWORD;\n'
    'const CORS_ORIGIN = process.env.REPORTS_CORS_ORIGIN || "*";'
)
if old_const not in src:
    print("ERROR: expected PASSWORD const line not found - no changes made.")
    sys.exit(1)
src = src.replace(old_const, new_const, 1)

old_server_start = '''const server = http.createServer((req, res) => {
    if (!checkAuth(req)) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Dracarys FX Pro Reports"' });
        res.end("Authentication required.");
        return;
    }

    const url = decodeURIComponent(req.url.split("?")[0]);'''

new_server_start = '''const server = http.createServer((req, res) => {
    // CORS preflight - browsers send this automatically before a fetch()
    // that includes an Authorization header. Must be answered before the
    // auth check, since the preflight request itself never carries auth.
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": CORS_ORIGIN,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization",
            "Access-Control-Max-Age": "86400"
        });
        res.end();
        return;
    }

    if (!checkAuth(req)) {
        res.writeHead(401, {
            "WWW-Authenticate": 'Basic realm="Dracarys FX Pro Reports"',
            "Access-Control-Allow-Origin": CORS_ORIGIN
        });
        res.end("Authentication required.");
        return;
    }

    const url = decodeURIComponent(req.url.split("?")[0]);

    if (url === "/api/latest") {
        try {
            const data = getLiveReportData();
            res.writeHead(200, {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": CORS_ORIGIN,
                "Cache-Control": "no-store"
            });
            res.end(JSON.stringify(data));
        } catch (err) {
            res.writeHead(500, {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": CORS_ORIGIN
            });
            res.end(JSON.stringify({ error: "Failed to load live data." }));
        }
        return;
    }'''

if old_server_start not in src:
    print("ERROR: expected server handler start block not found - no changes made.")
    sys.exit(1)
src = src.replace(old_server_start, new_server_start, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("reportServer.js: added GET /api/latest (CORS-enabled JSON endpoint)")
PYEOF

echo ""
if command -v node >/dev/null 2>&1; then
    node --check "$GEN_REPORT" && echo "Syntax check passed: $GEN_REPORT"
    node --check "$REPORT_SERVER" && echo "Syntax check passed: $REPORT_SERVER"
fi

echo ""
echo "Done. Phase 12 applied."
echo "Backups: ${GEN_REPORT}.bak, ${REPORT_SERVER}.bak"
echo ""
echo "Restart the reports server for this to take effect:"
echo "  sudo systemctl restart dracarys-reports"
echo ""
echo "Test it once restarted (replace with your real URL/credentials):"
echo "  curl -u USER:PASS https://YOUR-DOMAIN.nip.io/api/latest"
