#!/usr/bin/env bash
# Run this from the root of your dracarys-fx-pro repo.
# It copies the "recommended expiry" feature files into place.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(pwd)"

echo "Applying expiry-estimate feature files into: $REPO_ROOT"

mkdir -p "$REPO_ROOT/frontend/src/js/risk"
cp "$SCRIPT_DIR/expiryEstimate.js" "$REPO_ROOT/frontend/src/js/risk/expiryEstimate.js"
cp "$SCRIPT_DIR/signalEngine.js"   "$REPO_ROOT/frontend/src/js/signals/signalEngine.js"
cp "$SCRIPT_DIR/notify.js"         "$REPO_ROOT/frontend/scripts/scheduler/notify.js"
cp "$SCRIPT_DIR/index.html"        "$REPO_ROOT/frontend/index.html"
cp "$SCRIPT_DIR/app.js"            "$REPO_ROOT/frontend/src/js/core/app.js"

echo "Done. Files copied:"
echo "  frontend/src/js/risk/expiryEstimate.js  (new)"
echo "  frontend/src/js/signals/signalEngine.js (replaced)"
echo "  frontend/scripts/scheduler/notify.js    (replaced)"
echo "  frontend/index.html                     (replaced)"
echo "  frontend/src/js/core/app.js              (replaced)"
echo ""
echo "Now restart the scheduler and dashboard:"
echo "  cd frontend && npm run dev"
