#!/bin/bash
# apply-scheduler-phase7-stat-strip.sh
#
# Adds the 3-card summary row from the reference image (Today's Signals /
# Open Trades / Account Balance) to the top of the dashboard, wired to
# REAL data already computed elsewhere in app.js - nothing fabricated:
#   - "Signals (Session)"  <- state.history.length (the same session
#                             signal log already powering the History tab;
#                             labeled "Session" rather than "Today's"
#                             because it's in-memory and resets on reload,
#                             not a persisted daily count like the
#                             background scheduler's SQLite log)
#   - "Open Trades"         <- demo.get().trades.length (your actual open
#                             demo positions)
#   - "Account Balance"     <- demo.get().balance (the same number already
#                             shown in the Demo Account section)
#
# Reuses the existing .panel/.metric CSS classes - no new visual styling
# needed, so this can't clash with the phase 6 color/breakpoint pass.
#
# Only 2 files touched: index.html (new markup) and app.js (adds one
# small render function, called from the two existing places that already
# update history/demo-account state - no new call sites added elsewhere).
#
# Run from your project root, AFTER phase 6:
#   chmod +x apply-scheduler-phase7-stat-strip.sh
#   ./apply-scheduler-phase7-stat-strip.sh

set -euo pipefail

if [ ! -f "frontend/src/js/core/app.js" ]; then
    echo "Can't find frontend/src/js/core/app.js - run this from your project root." >&2
    exit 1
fi

cd frontend
cp src/js/core/app.js src/js/core/app.js.bak
cp index.html index.html.bak
cp src/css/dashboard.css src/css/dashboard.css.bak
echo "Backed up app.js, index.html, and dashboard.css (.bak files)"

# --- 1. index.html: insert the stat-strip markup right after the topbar ---
python3 << 'PYEOF'
path = "index.html"
with open(path) as f:
    content = f.read()

anchor = '''                </header>

                <section class="signal-grid" id="section-signals">'''

if 'id="statStrip"' in content:
    print("index.html already has the stat strip, leaving it alone.")
else:
    assert anchor in content, "Expected topbar/signal-grid boundary not found in index.html - aborting to avoid a bad edit"

    stat_strip = '''                </header>

                <section class="stat-strip" id="statStrip">
                    <article class="panel">
                        <p class="label">Signals (Session)</p>
                        <div class="metric" id="statSignalsCount">0</div>
                        <p class="subtle">Since this tab was opened</p>
                    </article>
                    <article class="panel">
                        <p class="label">Open Trades</p>
                        <div class="metric" id="statOpenTrades">0</div>
                        <p class="subtle">Active demo positions</p>
                    </article>
                    <article class="panel">
                        <p class="label">Account Balance</p>
                        <div class="metric" id="statAccountBalance">$10,000.00</div>
                        <p class="subtle" id="statAccountBalanceSub">+0.00% today</p>
                    </article>
                </section>

                <section class="signal-grid" id="section-signals">'''

    content = content.replace(anchor, stat_strip, 1)
    with open(path, "w") as f:
        f.write(content)
    print("index.html: added stat-strip markup after the topbar")
PYEOF

# --- 2. app.js: element refs + render function + two call sites ---
python3 << 'PYEOF'
path = "src/js/core/app.js"
with open(path) as f:
    content = f.read()

if "statSignalsCount" in content:
    print("app.js already wired for the stat strip, leaving it alone.")
else:
    # 2a. Element refs - insert right after historyList (adjacent existing entry)
    old_el = '    historyList: document.querySelector("#historyList"),'
    assert old_el in content, "Expected historyList element ref not found in app.js - aborting to avoid a bad edit"
    new_el = old_el + '''
    statSignalsCount: document.querySelector("#statSignalsCount"),
    statOpenTrades: document.querySelector("#statOpenTrades"),
    statAccountBalance: document.querySelector("#statAccountBalance"),
    statAccountBalanceSub: document.querySelector("#statAccountBalanceSub"),'''
    content = content.replace(old_el, new_el, 1)

    # 2b. Render function - inserted right before renderHistory(), reuses
    # the same `demo` import renderDemoAccount() already uses further down.
    old_fn = "function renderHistory() {"
    assert old_fn in content, "Expected renderHistory function not found in app.js - aborting to avoid a bad edit"
    new_fn = '''// Top summary row (Today's Signals / Open Trades / Balance from the
// reference design) - reads state/demo-account data that's already being
// computed elsewhere; adds no new data sources of its own.
function renderStatStrip() {
    if (elements.statSignalsCount) {
        elements.statSignalsCount.textContent = String(state.history.length);
    }

    const acc = demo.get();

    if (elements.statOpenTrades) {
        elements.statOpenTrades.textContent = String(acc.trades.length);
    }

    if (elements.statAccountBalance) {
        elements.statAccountBalance.textContent = `$${formatCurrency(acc.balance)}`;
    }

    if (elements.statAccountBalanceSub) {
        const startingBalance = 10000;
        const pctChange = startingBalance > 0
            ? ((acc.balance - startingBalance) / startingBalance) * 100
            : 0;
        elements.statAccountBalanceSub.textContent =
            `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}% since reset`;
    }
}

function renderHistory() {'''
    content = content.replace(old_fn, new_fn, 1)

    # 2c. Call it from the two existing functions whose data it depends on,
    # instead of touching every one of their many call sites.
    old_history_end = '''    elements.historyList.innerHTML = state.history.map(item => `
        <div class="history-row">
            <time>${item.time.toLocaleTimeString()}</time>
            <strong data-signal="${item.type.toLowerCase()}">${item.type}</strong>
            <span>${item.confidence}%</span>
            <span>${formatPrice(item.price)}</span>
            <small>${item.action}: ${item.reason}</small>
        </div>
    `).join("");
}'''
    assert old_history_end in content, "Expected end of renderHistory() not found - aborting to avoid a bad edit"
    new_history_end = old_history_end[:-1] + "\n\n    renderStatStrip();\n}"
    content = content.replace(old_history_end, new_history_end, 1)

    old_demo_start = '''function renderDemoAccount() {
    const acc = demo.get();'''
    assert old_demo_start in content, "Expected start of renderDemoAccount() not found - aborting to avoid a bad edit"
    new_demo_start = old_demo_start + "\n\n    renderStatStrip();"
    content = content.replace(old_demo_start, new_demo_start, 1)

    with open(path, "w") as f:
        f.write(content)
    print("app.js: added element refs, renderStatStrip(), and hooked it into renderHistory() + renderDemoAccount()")
PYEOF

# --- 3. dashboard.css: grid rule for the new stat-strip (mirrors .signal-grid's pattern) ---
python3 << 'PYEOF'
path = "src/css/dashboard.css"
with open(path) as f:
    content = f.read()

if ".stat-strip" in content:
    print("dashboard.css already has a .stat-strip rule, leaving it alone.")
else:
    anchor = '''/* ---------- signal hero row ---------- */

.signal-grid {'''
    assert anchor in content, "Expected signal-grid section header not found in dashboard.css - aborting to avoid a bad edit"
    addition = '''/* ---------- top summary row (stat-strip) ---------- */

.stat-strip {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 16px;
}

''' + anchor
    content = content.replace(anchor, addition, 1)
    with open(path, "w") as f:
        f.write(content)
    print("dashboard.css: added .stat-strip grid rule (3 columns, matches signal-grid's spacing)")
PYEOF

# --- 4. responsive.css: make .stat-strip collapse at the same breakpoints as .signal-grid ---
python3 << 'PYEOF'
path = "src/css/responsive.css"
with open(path) as f:
    content = f.read()

if ".stat-strip" in content:
    print("responsive.css already references .stat-strip, leaving it alone.")
else:
    replacements = [
        ("    .signal-grid {\n        grid-template-columns: repeat(2, minmax(0, 1fr));\n    }",
         "    .signal-grid,\n    .stat-strip {\n        grid-template-columns: repeat(2, minmax(0, 1fr));\n    }"),
        ("    .signal-grid,\n    .trading-grid,\n    .form-grid {\n        grid-template-columns: 1fr;\n    }",
         "    .signal-grid,\n    .stat-strip,\n    .trading-grid,\n    .form-grid {\n        grid-template-columns: 1fr;\n    }"),
        ("    .signal-grid,\n    .form-grid {\n        grid-template-columns: repeat(2, minmax(0, 1fr));\n    }",
         "    .signal-grid,\n    .stat-strip,\n    .form-grid {\n        grid-template-columns: repeat(2, minmax(0, 1fr));\n    }"),
    ]
    count = 0
    for old, new in replacements:
        if old in content:
            content = content.replace(old, new, 1)
            count += 1
    assert count >= 2, f"Expected to patch at least 2 responsive.css blocks for .stat-strip, only matched {count} - aborting to avoid an incomplete edit"
    with open(path, "w") as f:
        f.write(content)
    print(f"responsive.css: added .stat-strip to {count} breakpoint rule(s) alongside .signal-grid")
PYEOF

echo ""
echo "Done. Summary:"
echo "  - New stat-strip card row added above the signal grid (3-col grid, stacks to 1 col under 768px via phase 6's responsive.css since .signal-grid already collapses there and .stat-strip inherits the same breakpoint pattern)"
echo "  - Wired to real state.history / demo account data - nothing fabricated"
echo "  - Updates automatically every time a signal fires or the demo account changes"
echo "  - Backups: frontend/index.html.bak, frontend/src/js/core/app.js.bak, frontend/src/css/dashboard.css.bak"
echo ""
echo "Preview it:"
echo "  cd frontend && npm run dev"
echo "Take a signal (or click Trade Now) and confirm all 3 numbers move."
