#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
required=(
  "api/live-reports.js"
  "frontend/scripts/scheduler/reportServer.js"
  "frontend/scripts/scheduler/generateReport.js"
  "setup-gcp-reports-server.sh"
  "setup-gcp-https.sh"
)

for file in "${required[@]}"; do
    [[ -f "$file" ]] || { echo "Missing required file: $file" >&2; exit 1; }
done

./upgrade-dashboard/verify.sh
echo "Live Reports upgrade is installed in this checkout."
echo "Next: deploy the GCP report service, set the three REPORTS_API_* variables in Vercel, then redeploy."
