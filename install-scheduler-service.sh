#!/bin/bash
# Run this once from the root of your Dracarys FX Pro project
# (the folder that contains "frontend/"). It installs the scheduler
# as a launchd service so it keeps running after you close VS Code,
# after sleep, and after reboots - starting automatically on login.
#
# Usage:
#   cd /path/to/dracarys-fx-pro
#   chmod +x install-scheduler-service.sh
#   ./install-scheduler-service.sh

set -euo pipefail

PROJECT_PATH="$(pwd)"
PLIST_NAME="com.dracarysfxpro.scheduler.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
NPM_PATH="$(command -v npm)"

if [[ ! -d "$PROJECT_PATH/frontend" ]]; then
    echo "Error: no 'frontend' folder here. cd into your project root first."
    exit 1
fi

if [[ -z "$NPM_PATH" ]]; then
    echo "Error: npm not found on PATH. Is Node installed (nvm/brew)?"
    exit 1
fi

echo "Project path : $PROJECT_PATH"
echo "npm path     : $NPM_PATH"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$PROJECT_PATH/frontend/data"

# Fill in the template and write it to LaunchAgents
sed -e "s|PROJECT_PATH|$PROJECT_PATH|g" \
    -e "s|NPM_PATH|$NPM_PATH|g" \
    "$PROJECT_PATH/com.dracarysfxpro.scheduler.plist" > "$PLIST_DEST"

# Unload any previous version first (ignore error if not loaded yet)
launchctl unload "$PLIST_DEST" 2>/dev/null || true

launchctl load "$PLIST_DEST"

echo ""
echo "Installed and started. Useful commands:"
echo "  Check it's running:  launchctl list | grep dracarysfxpro"
echo "  Tail live output:    tail -f \"$PROJECT_PATH/frontend/data/scheduler.log\""
echo "  Tail errors:         tail -f \"$PROJECT_PATH/frontend/data/scheduler.error.log\""
echo "  Stop it:             launchctl unload \"$PLIST_DEST\""
echo "  Start it again:      launchctl load \"$PLIST_DEST\""
