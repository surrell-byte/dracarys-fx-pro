#!/usr/bin/env bash
# Run this ON the GCP VM, after setup-gcp-vm.sh has already been run and
# frontend/.env has REPORTS_USER / REPORTS_PASSWORD / REPORTS_PORT set.
set -euo pipefail

PROJECT_DIR="$(pwd)"
SERVICE_NAME="dracarys-reports"
PORT="${REPORTS_PORT:-8787}"

# Verify prerequisites
if [ ! -f "$PROJECT_DIR/frontend/.env" ]; then
    echo "ERROR: frontend/.env not found. Run setup-gcp-vm.sh first."
    exit 1
fi

if [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
    echo "ERROR: frontend/node_modules not found. Run setup-gcp-vm.sh first to install dependencies."
    exit 1
fi

# Validate both REPORTS_USER and REPORTS_PASSWORD are set (not just present as empty keys)
if ! grep -q "REPORTS_USER=[^[:space:]]" "$PROJECT_DIR/frontend/.env" || ! grep -q "REPORTS_PASSWORD=[^[:space:]]" "$PROJECT_DIR/frontend/.env"; then
    echo "ERROR: frontend/.env needs both REPORTS_USER and REPORTS_PASSWORD set (not just present as empty keys)."
    echo "Add them, then re-run this script."
    exit 1
fi

echo "== Opening firewall port ${PORT} (Ubuntu's local firewall) =="
if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow "${PORT}/tcp" || true
fi

echo ""
echo "IMPORTANT - like Oracle's Security List, GCP has its own"
echo "network-level firewall separate from the VM's own ufw. Do ONE of"
echo "the following, or the port stays blocked no matter what:"
echo ""
echo "  Option A - if you have the gcloud CLI installed locally, run this"
echo "  from your Mac (not on the VM):"
echo "    gcloud compute firewall-rules create allow-dracarys-reports \\"
echo "      --allow=tcp:${PORT} --source-ranges=0.0.0.0/0"
echo ""
echo "  Option B - in the Console: Navigation menu -> VPC network ->"
echo "  Firewall -> Create Firewall Rule"
echo "    Targets: All instances in the network"
echo "    Source IPv4 ranges: 0.0.0.0/0"
echo "    Protocols/ports: tcp:${PORT}"
echo ""
read -p "Press Enter once you've created that firewall rule (or if it's already done)..."

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
StandardOutput=append:${PROJECT_DIR}/frontend/data/reports-server.log
StandardError=append:${PROJECT_DIR}/frontend/data/reports-server.error.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# Post-start health check
sleep 2
if ! sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "ERROR: reports server failed to start. Check logs with:"
    echo "  sudo systemctl status ${SERVICE_NAME}"
    echo "  journalctl -u ${SERVICE_NAME} -n 50"
    exit 1
fi

PUBLIC_IP="$(curl -s -4 ifconfig.me || echo YOUR_SERVER_IP)"

echo ""
echo "Done. Reports are now reachable at:"
echo "  http://${PUBLIC_IP}:${PORT}"
echo ""
echo "Bookmark that on your phone. It'll ask for the REPORTS_USER /"
echo "REPORTS_PASSWORD you set in frontend/.env."
echo ""
echo "Check status:   sudo systemctl status ${SERVICE_NAME}"
echo "Live logs:      journalctl -u ${SERVICE_NAME} -f"
echo ""
echo "Note: this is plain HTTP, not HTTPS - fine for glancing at trade"
echo "reports, but don't reuse a password you care about elsewhere for"
echo "REPORTS_PASSWORD, since it isn't encrypted in transit."
