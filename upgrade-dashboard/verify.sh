#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
npm run build
node --check api/live-reports.js
node --check api/report-history.js
node --check frontend/scripts/scheduler/reportServer.js
echo "Verified: production frontend build and live-report API syntax are valid."
