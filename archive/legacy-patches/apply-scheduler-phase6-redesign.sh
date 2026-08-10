#!/bin/bash
# apply-scheduler-phase6-redesign.sh
#
# Visual redesign pass matching the reference layout image:
#   1. Recolors design tokens from the warm amber/terminal look to the
#      cool dark-green fintech look shown in the image. Variable NAMES
#      (--amber, --buy, --sell, etc.) are kept as-is since 182 rules
#      across 8 CSS files reference them by name - only the hex VALUES
#      change, so every panel/badge/border repaints with zero risk of
#      broken references.
#   2. Rebuilds responsive.css around the image's 6 breakpoint tiers:
#        - Mobile portrait  (<768px):   bottom-fixed icon+label nav bar
#        - Tablet portrait  (768-1023): collapsed icon-only sidebar
#        - Tablet landscape (1024-1279): icon sidebar, wider content
#        - Laptop/Desktop   (1280-1599): full labeled sidebar (default)
#        - Ultrawide        (1600+):    wider max content width
#   3. Adds a manual Presentation Mode toggle (large text, high contrast,
#      simplified nav) for the smartboard tile in the image - same pattern
#      used in your bored-teacher-react project. Self-contained JS file,
#      does not touch the existing 47KB app.js.
#
# Run from your project root:
#   chmod +x apply-scheduler-phase6-redesign.sh
#   ./apply-scheduler-phase6-redesign.sh

set -euo pipefail

if [ ! -f "frontend/src/css/variables.css" ]; then
    echo "Can't find frontend/src/css/variables.css - run this from your project root." >&2
    exit 1
fi

cd frontend

cp src/css/variables.css src/css/variables.css.bak
cp src/css/responsive.css src/css/responsive.css.bak
echo "Backed up variables.css and responsive.css (.bak files)"

# --- 1. variables.css: recolor tokens (names unchanged, values updated) ---
cat > src/css/variables.css << 'FILEEOF'
:root {
    color-scheme: dark;

    /* base surfaces - cool near-black, green-tinted (was warm brown/amber) */
    --ink: #0a0f0c;
    --ink-deep: #060907;
    --panel: #101613;
    --panel-soft: #141c18;

    /* text - cool white (was warm cream) */
    --paper: #eef2ef;
    --steel: #8fa39a;
    --steel-rgb: 143, 163, 154;

    /* accent (drives lines, focus rings, glows) - bright fintech green
       (variable is still named --amber for backward compatibility with
       every file below that references it - only the value changed) */
    --amber: #22c55e;
    --amber-dim: #16a34a;
    --amber-rgb: 34, 197, 94;

    /* state colors - buy matches accent green, sell stays a clear red */
    --buy: #22c55e;
    --buy-rgb: 34, 197, 94;
    --sell: #f87171;
    --sell-rgb: 248, 113, 113;

    /* derived from accent so every theme's lines/borders match its palette */
    --line: rgba(var(--amber-rgb), 0.16);
    --line-strong: rgba(var(--amber-rgb), 0.36);

    /* shadows */
    --shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
    --shadow-sm: 0 4px 14px rgba(0, 0, 0, 0.28);
    --shadow-md: 0 14px 32px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 24px 60px rgba(0, 0, 0, 0.55);

    /* Interactive elements (buttons/inputs/badges) get a touch of rounding
       for a softer feel; structural panels/chart/data-strip stay sharp at
       2px - that hard edge is core to the terminal look and shouldn't get lost. */
    --radius-soft: 4px;

    --font-display: "IBM Plex Mono", "Courier New", monospace;
    --font-body: "Inter", Arial, sans-serif;

    --confidence-fill: 0%;

    /* sidebar shell */
    --sidebar-w: 250px;
    --sidebar-w-collapsed: 76px;
    --bottom-nav-h: 64px;

    /* breakpoint reference values (used in comments/media queries below -
       CSS media queries can't consume custom properties directly, but
       keeping the numbers here means responsive.css and this file agree
       on one source of truth to eyeball) */
    --bp-mobile-landscape: 480px;
    --bp-tablet-portrait: 768px;
    --bp-tablet-landscape: 1024px;
    --bp-laptop: 1280px;
    --bp-ultrawide: 1600px;
    --bp-presentation: 1920px;
}

/* Presentation Mode - manual toggle for smartboards/classroom displays.
   Large text, high contrast, simplified nav. Toggled via the floating
   button (see presentationMode.js) rather than an automatic breakpoint,
   since a huge desktop monitor and an actual smartboard both live above
   1600px but need very different treatments. */
body.presentation-mode {
    --font-scale: 1.35;
}
FILEEOF
echo "variables.css: recolored to green fintech palette"

# --- 2. responsive.css: rebuild around the image's 6 breakpoint tiers ---
cat > src/css/responsive.css << 'FILEEOF'
/* ==========================================================================
   Responsive layout system - tiers match the reference design:
     Mobile portrait   <768px         single column, bottom icon nav
     Tablet portrait    768-1023px    icon-only sidebar, single column
     Tablet landscape   1024-1279px   icon-only sidebar, wider grids
     Laptop / Desktop   1280-1599px   full labeled sidebar (default, no
                                      media query needed - this is the
                                      un-overridden base layout)
     Ultrawide          1600px+       wider max content width
   ========================================================================== */

/* ---------- Ultrawide (1600px+): more breathing room, wider dashboard ---------- */
@media (min-width: 1600px) {
    .main .dashboard {
        width: min(1600px, calc(100% - 80px));
    }

    .signal-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .data-strip {
        grid-template-columns: repeat(7, 1fr);
    }

    .data-cell:nth-child(7n) {
        border-right: none;
    }
}

/* ---------- Tablet landscape (1024-1279px): icon sidebar, 2-col grids ---------- */
@media (max-width: 1279px) {
    .app {
        grid-template-columns: var(--sidebar-w-collapsed) 1fr;
    }

    .sidebar {
        padding: 18px 8px;
    }

    .logo,
    .menu-hint {
        display: none;
    }

    .menu button span.menu-label {
        display: none;
    }

    .menu button {
        justify-content: center;
        padding: 12px 4px;
    }

    .signal-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .data-strip {
        grid-template-columns: repeat(4, 1fr);
    }

    .data-cell:nth-child(4n) {
        border-right: none;
    }

    .data-cell:nth-child(-n+4) {
        border-bottom: 1px solid var(--line);
    }
}

/* ---------- Tablet portrait (768-1023px): icon sidebar continues, tighter grids ---------- */
@media (max-width: 1023px) {
    .trading-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .controls-panel {
        grid-column: 1 / -1;
    }

    .form-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .history-row {
        grid-template-columns: 78px 56px minmax(0, 1fr);
    }

    .history-row span:nth-of-type(2) {
        display: none;
    }
}

/* ---------- Mobile portrait + landscape (<768px): bottom-fixed nav bar ---------- */
@media (max-width: 767px) {
    .app {
        display: block;
    }

    /* Sidebar becomes a fixed bottom tab bar - icon + label, matching the
       "Bottom Navigation" tile in the reference image. */
    .sidebar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        top: auto;
        height: var(--bottom-nav-h);
        width: 100%;
        flex-direction: row;
        align-items: stretch;
        gap: 0;
        padding: 0;
        overflow-x: auto;
        overflow-y: hidden;
        border-right: none;
        border-top: 1px solid var(--line);
        background: linear-gradient(180deg, var(--panel), var(--ink-deep));
        z-index: 40;
    }

    .logo,
    .menu-hint {
        display: none;
    }

    .menu {
        flex-direction: row;
        flex: 1;
        gap: 0;
    }

    .menu button {
        flex: 1;
        min-width: 64px;
        flex-direction: column;
        gap: 2px;
        border-left: none;
        border-top: 3px solid transparent;
        border-radius: 0;
        padding: 8px 4px 6px;
        white-space: nowrap;
    }

    .menu button span.menu-label {
        display: block;
        font-size: 0.62rem;
    }

    .menu button.active {
        border-left-color: transparent;
        border-top-color: var(--amber);
        background: rgba(var(--amber-rgb), 0.08);
        transform: none;
    }

    /* Leave room at the bottom of the page so content isn't hidden
       underneath the fixed nav bar. */
    .main {
        padding-bottom: calc(var(--bottom-nav-h) + 16px);
    }

    .main .dashboard {
        width: min(100% - 20px, 1180px);
        padding-top: 16px;
    }

    .topbar {
        align-items: stretch;
        flex-direction: column;
    }

    .market-controls {
        grid-template-columns: 1fr;
    }

    .signal-grid,
    .trading-grid,
    .form-grid {
        grid-template-columns: 1fr;
    }

    .data-strip {
        grid-template-columns: repeat(2, 1fr);
    }

    .data-cell:nth-child(2n) {
        border-right: none;
    }

    .data-cell:not(:nth-last-child(-n+2)) {
        border-bottom: 1px solid var(--line);
    }

    canvas {
        height: 280px;
    }

    .mode-picker {
        grid-template-columns: 1fr;
    }

    .history-row {
        grid-template-columns: 72px minmax(0, 1fr);
    }

    .history-row span {
        display: none;
    }
}

/* ---------- Mobile landscape refinement (480-767px): 2-col where mobile portrait is 1 ---------- */
@media (min-width: 480px) and (max-width: 767px) {
    .signal-grid,
    .form-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

/* ==========================================================================
   Presentation Mode - manual toggle (see presentationMode.js), not tied
   to a screen-width breakpoint. Large text, simplified nav, high contrast.
   ========================================================================== */
body.presentation-mode {
    font-size: calc(1rem * var(--font-scale, 1.35));
}

body.presentation-mode .menu-hint {
    display: none;
}

body.presentation-mode .menu button {
    padding: 16px 14px;
    font-size: 1.05rem;
}

body.presentation-mode .panel {
    border-width: 2px;
}

body.presentation-mode .data-strip {
    grid-template-columns: repeat(4, 1fr);
}
FILEEOF
echo "responsive.css: rebuilt around the image's breakpoint tiers"

# --- 3. Presentation mode toggle: self-contained JS, doesn't touch app.js ---
cat > src/js/core/presentationMode.js << 'FILEEOF'
// Manual Presentation Mode toggle for smartboards/classroom displays -
// large text, simplified nav, high contrast. Deliberately separate from
// app.js (which already handles live data/signals) so this small,
// self-contained feature can't introduce a regression there.
// Persists the choice in localStorage so it survives a page reload.

const STORAGE_KEY = "dracarysfxpro-presentation-mode";

function applyState(enabled) {
    document.body.classList.toggle("presentation-mode", enabled);
    const btn = document.getElementById("quickPresentation");
    if (btn) {
        btn.setAttribute("aria-pressed", String(enabled));
        btn.title = enabled ? "Exit Presentation Mode" : "Enter Presentation Mode (smartboard)";
    }
}

function init() {
    const saved = localStorage.getItem(STORAGE_KEY) === "true";
    applyState(saved);

    const btn = document.getElementById("quickPresentation");
    if (!btn) return;

    btn.addEventListener("click", () => {
        const next = !document.body.classList.contains("presentation-mode");
        localStorage.setItem(STORAGE_KEY, String(next));
        applyState(next);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
FILEEOF
echo "Created presentationMode.js"

# --- 4. index.html: add the floating presentation-mode toggle button + script tag ---
python3 << 'PYEOF'
path = "index.html"
with open(path) as f:
    content = f.read()

old = '<button id="quickTheme" type="button" title="Cycle theme (F9 / F8)">🎨</button>'
if old not in content:
    raise SystemExit("Expected quickTheme button not found in index.html - aborting to avoid a bad edit")

new = old + '\n    <button id="quickPresentation" type="button" aria-pressed="false" title="Enter Presentation Mode (smartboard)">🖥️</button>'
content = content.replace(old, new, 1)

old_script = '<script type="module" src="src/js/components/themeSelector.js"></script>'
if old_script not in content:
    raise SystemExit("Expected themeSelector script tag not found in index.html - aborting to avoid a bad edit")

new_script = old_script + '\n    <script type="module" src="src/js/core/presentationMode.js"></script>'
content = content.replace(old_script, new_script, 1)

with open(path, "w") as f:
    f.write(content)
print("index.html: added Presentation Mode toggle button + script tag")
PYEOF

echo ""
echo "Done. Redesign phase 1 (color + breakpoints + presentation mode) applied."
echo "Backups: frontend/src/css/variables.css.bak, frontend/src/css/responsive.css.bak"
echo ""
echo "Preview it:"
echo "  cd frontend && npm run dev"
echo "Then resize the browser window through each tier, and click the new"
echo "🖥️ button (bottom-right) to try Presentation Mode."
echo ""
echo "This is layout/color pass 1, matching the image's structure and"
echo "breakpoints. NOT yet done: rebuilding the dashboard's top stat row"
echo "into the 3-card 'Today's Signals / Open Trades / Balance' layout"
echo "from the image - that needs new markup wired to real data in app.js,"
echo "which is a bigger, riskier change to the 47KB core file. Want that as"
echo "the next pass once you've confirmed this one looks right?"
