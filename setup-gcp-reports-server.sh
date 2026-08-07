#!/usr/bin/env bash
# Run this ON the GCP VM, after setup-gcp-vm.sh has already been run and
# frontend/.env has REPORTS_USER / REPORTS_PASSWORD / REPORTS_PORT set. The
# report service binds only to localhost; Caddy publishes HTTPS on port 443.
set -euo pipefail

PROJECT_DIR="$(pwd)"
SERVICE_NAME="dracarys-reports"
PORT="${REPORTS_PORT:-8787}"

if [ ! -f "$PROJECT_DIR/frontend/.env" ] || ! grep -q "REPORTS_USER=." "$PROJECT_DIR/frontend/.env"; then
    echo "ERROR: frontend/.env needs REPORTS_USER and REPORTS_PASSWORD set (not just present as empty keys)."
    echo "Add them, then re-run this script."
    exit 1
fi

echo "== Registering systemd service =="
NPM_BIN="$(command -v npm)"

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null << EOF
[Unit]
Description=Dracarys FX Pro report server (read-only, Basic Auth)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}/frontend
ExecStart=${NPM_BIN} run reports-server
Restart=always
RestartSec=5
User=$(whoami)
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "Done. Reports server is listening privately on 127.0.0.1:${PORT}."
echo ""
echo "Next, run setup-gcp-https.sh to publish it securely through Caddy."
echo ""
echo "Check status:   sudo systemctl status ${SERVICE_NAME}"
echo "Live logs:      journalctl -u ${SERVICE_NAME} -f"
