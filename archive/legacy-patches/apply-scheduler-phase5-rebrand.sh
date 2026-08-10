#!/bin/bash
# apply-scheduler-phase5-rebrand.sh
#
# Renames the project from "OTC Signal AI Pro" / "atlas-ai-frontend" to
# "Dracarys FX Pro" everywhere it appears in code, config, and UI text.
#
# Scope (found by grepping the whole project for otc/atlas references):
#   - root package.json + frontend/package.json "name" fields
#   - frontend/index.html: <title>, sidebar logo, dashboard <h1>
#   - frontend/src/js/core/themeManager.js: document.title template
#   - frontend/scripts/scheduler/report.js: daily report <title> + <h1>
#   - localStorage key prefixes (demoAccount.js, strategyTester.js,
#     binaryTracker.js, themeManager.js) - renaming these means any demo
#     data/theme choice saved in your browser under the old keys will not
#     carry over (browser just starts fresh under the new keys - nothing
#     is deleted, the old data just becomes orphaned/unused).
#   - the launchd service label (com.otcsignal.scheduler ->
#     com.dracarysfxpro.scheduler) - this re-registers the background
#     service under the new name, so this script unloads the old one and
#     you'll load the new plist afterward.
#
# NOT touched (deliberately):
#   - frontend/src/js/analysis/binaryTracker.js line 13 ("Typical OTC
#     short-expiry binary payout") - this is the trading industry term
#     (over-the-counter), not the brand name, so it's left alone.
#   - your project folder name / zip filename - purely cosmetic, rename
#     manually if you want (`mv` the folder), not worth scripting.
#
# Run from your project root:
#   chmod +x apply-scheduler-phase5-rebrand.sh
#   ./apply-scheduler-phase5-rebrand.sh

set -euo pipefail

if [ ! -f "frontend/index.html" ]; then
    echo "Can't find frontend/index.html - run this from your project root." >&2
    exit 1
fi

# --- 1. package.json name fields ---
python3 << 'PYEOF'
import re

for path, old, new in [
    ("package.json", '"name": "otc-signal-ai-pro"', '"name": "dracarys-fx-pro"'),
    ("frontend/package.json", '"name": "atlas-ai-frontend"', '"name": "dracarys-fx-pro-frontend"'),
]:
    with open(path) as f:
        content = f.read()
    assert old in content, f"Expected {old!r} not found in {path} - aborting to avoid a bad edit"
    content = content.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(content)
    print(f"{path}: renamed package name")
PYEOF

# --- 2. frontend/index.html: title, logo, dashboard heading ---
python3 << 'PYEOF'
path = "frontend/index.html"
with open(path) as f:
    content = f.read()

replacements = [
    ("<title>OTC Signal AI Pro</title>", "<title>Dracarys FX Pro</title>"),
    ('<div class="logo">OTC<span>·</span>AI</div>', '<div class="logo">DRACARYS<span>·</span>FX</div>'),
    ("<h1>OTC Signal AI Pro</h1>", "<h1>Dracarys FX Pro</h1>"),
]

for old, new in replacements:
    assert old in content, f"Expected {old!r} not found in index.html - aborting to avoid a bad edit"
    content = content.replace(old, new, 1)

with open(path, "w") as f:
    f.write(content)
print("frontend/index.html: rebranded title, logo, and dashboard heading")
PYEOF

# --- 3. themeManager.js: document.title template + storage key ---
python3 << 'PYEOF'
path = "frontend/src/js/core/themeManager.js"
with open(path) as f:
    content = f.read()

replacements = [
    ('document.title = `OTC Signal AI Pro • ${theme.name}`;',
     'document.title = `Dracarys FX Pro • ${theme.name}`;'),
    ('const STORAGE_KEY = "otc-ai-pro-theme";',
     'const STORAGE_KEY = "dracarysfxpro-theme";'),
]

for old, new in replacements:
    assert old in content, f"Expected {old!r} not found in themeManager.js - aborting to avoid a bad edit"
    content = content.replace(old, new, 1)

with open(path, "w") as f:
    f.write(content)
print("themeManager.js: rebranded document title template + storage key")
PYEOF

# --- 4. report.js: daily report HTML title + heading ---
python3 << 'PYEOF'
path = "frontend/scripts/scheduler/report.js"
with open(path) as f:
    content = f.read()

replacements = [
    ("<title>OTC Signal AI Pro — Daily Report — ${escapeHtml(data.dateLabel)}</title>",
     "<title>Dracarys FX Pro — Daily Report — ${escapeHtml(data.dateLabel)}</title>"),
    ("<h1>OTC Signal AI Pro — Daily Report</h1>",
     "<h1>Dracarys FX Pro — Daily Report</h1>"),
]

for old, new in replacements:
    assert old in content, f"Expected {old!r} not found in report.js - aborting to avoid a bad edit"
    content = content.replace(old, new, 1)

with open(path, "w") as f:
    f.write(content)
print("report.js: rebranded daily report title + heading")
PYEOF

# --- 5. Remaining localStorage key prefixes ---
python3 << 'PYEOF'
for path, old, new in [
    ("frontend/src/js/demo/demoAccount.js", 'const STORAGE_KEY = "otc-demo-account-v2";', 'const STORAGE_KEY = "dracarysfxpro-demo-account-v2";'),
    ("frontend/src/js/analysis/strategyTester.js", 'const STORAGE_KEY = "otc-strategy-tester-v1";', 'const STORAGE_KEY = "dracarysfxpro-strategy-tester-v1";'),
    ("frontend/src/js/analysis/binaryTracker.js", 'const STORAGE_KEY = "otc-binary-tracker-v1";', 'const STORAGE_KEY = "dracarysfxpro-binary-tracker-v1";'),
]:
    with open(path) as f:
        content = f.read()
    assert old in content, f"Expected {old!r} not found in {path} - aborting to avoid a bad edit"
    content = content.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(content)
    print(f"{path}: renamed storage key")
PYEOF

# --- 6. launchd service label ---
if [ -f "com.otcsignal.scheduler.plist" ]; then
    sed 's/com\.otcsignal\.scheduler/com.dracarysfxpro.scheduler/g' com.otcsignal.scheduler.plist > com.dracarysfxpro.scheduler.plist
    echo "Created com.dracarysfxpro.scheduler.plist (new label, same settings as before)"

    if [ -f "$HOME/Library/LaunchAgents/com.otcsignal.scheduler.plist" ]; then
        launchctl unload "$HOME/Library/LaunchAgents/com.otcsignal.scheduler.plist" 2>/dev/null || true
        rm -f "$HOME/Library/LaunchAgents/com.otcsignal.scheduler.plist"
        cp com.dracarysfxpro.scheduler.plist "$HOME/Library/LaunchAgents/com.dracarysfxpro.scheduler.plist"
        launchctl load "$HOME/Library/LaunchAgents/com.dracarysfxpro.scheduler.plist"
        echo "Old service unloaded and removed; new com.dracarysfxpro.scheduler loaded and running."
    else
        echo "No existing installed service found at ~/Library/LaunchAgents/com.otcsignal.scheduler.plist"
        echo "  -> load the new one manually: launchctl load ~/Library/LaunchAgents/com.dracarysfxpro.scheduler.plist"
    fi
    rm -f com.otcsignal.scheduler.plist
fi

echo ""
echo "Done. Rebrand complete:"
echo "  - Package names, page title, logo, dashboard heading, daily report -> Dracarys FX Pro"
echo "  - localStorage keys renamed (old browser-saved demo data/theme won't carry over - nothing deleted, just orphaned)"
echo "  - launchd service re-registered under com.dracarysfxpro.scheduler"
echo ""
echo "Verify the service is running under its new name:"
echo "  launchctl list | grep dracarysfxpro"
echo ""
echo "Not touched (cosmetic only, do manually if you want):"
echo "  - your project folder name and the uploaded zip filename"
