#!/usr/bin/env bash
set -euo pipefail

REPORT_JS="frontend/scripts/scheduler/report.js"

if [ ! -f "$REPORT_JS" ]; then
    echo "ERROR: $REPORT_JS not found. Run this from your project root."
    exit 1
fi

cp "$REPORT_JS" "${REPORT_JS}.bak"
echo "Backed up report.js (.bak)"

# --- recolor the inline :root palette inside renderReportHtml() ---
# old (amber/blue GitHub-dark palette) -> new (green fintech, matches variables.css)
#   --bg      #0d1117 -> #0a0f0c   (--ink)
#   --panel   #161b22 -> #101613   (--panel)
#   --border  #30363d -> #1c2620   (dark green-tinted border)
#   --text    #e6edf3 -> #eef2ef   (--paper)
#   --muted   #8b949e -> #8fa39a   (--steel)
#   --pos     #3fb950 -> #22c55e   (--buy / --amber)
#   --neg     #f85149 -> #f87171   (--sell)
#   --accent  #58a6ff -> #22c55e   (--amber)
python3 - "$REPORT_JS" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old_root = '--bg: #0d1117; --panel: #161b22; --border: #30363d; --text: #e6edf3;\n        --muted: #8b949e; --pos: #3fb950; --neg: #f85149; --accent: #58a6ff;'
new_root = '--bg: #0a0f0c; --panel: #101613; --border: #1c2620; --text: #eef2ef;\n        --muted: #8fa39a; --pos: #22c55e; --neg: #f87171; --accent: #22c55e;'

if old_root not in src:
    print("ERROR: expected :root block not found (report.js may have changed) - no changes made.")
    sys.exit(1)

src = src.replace(old_root, new_root, 1)

# badge backgrounds reference the old literal rgb values directly, not the vars
src = src.replace(
    '.badge.buy { background: rgba(63,185,80,0.15); color: var(--pos); }',
    '.badge.buy { background: rgba(34,197,94,0.15); color: var(--pos); }'
)
src = src.replace(
    '.badge.sell { background: rgba(248,81,73,0.15); color: var(--neg); }',
    '.badge.sell { background: rgba(248,113,113,0.15); color: var(--neg); }'
)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("report.js: recolored inline :root palette + badge backgrounds to green fintech theme")
PYEOF

# --- sanity check: valid JS syntax ---
if command -v node >/dev/null 2>&1; then
    node --check "$REPORT_JS" && echo "Syntax check passed: $REPORT_JS"
fi

echo ""
echo "Done. Phase 8 applied."
echo "Backup: ${REPORT_JS}.bak"
echo ""
echo "Preview it:"
echo "  cd frontend && node scripts/scheduler/cli-report.js"
echo "  (or wait for the 18:00 auto-run) then open the generated report.html"
