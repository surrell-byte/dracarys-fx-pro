#!/usr/bin/env bash
# Run this ON the GCP e2-micro VM (via the Console's browser SSH, or your
# own ssh/gcloud), from the folder you uploaded your project into, e.g.
# ~/dracarys-fx-pro/
set -euo pipefail

PROJECT_DIR="$(pwd)"
SERVICE_NAME="dracarys-scheduler"

echo "== Installing Node.js 20 and build tools =="
if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs build-essential python3
else
    echo "Node already installed: $(node --version)"
fi

if [ ! -d "$PROJECT_DIR/frontend" ]; then
    echo "ERROR: expected ./frontend here — run this from your project root ($PROJECT_DIR has no frontend/ dir)."
    exit 1
fi

# Ensure data directory exists for scheduler logs
mkdir -p "$PROJECT_DIR/frontend/data"

echo "== Installing npm dependencies (native modules built fresh for this server) =="
cd "$PROJECT_DIR/frontend"
npm install --include=dev

# Validate required files exist
if [ ! -f "$PROJECT_DIR/frontend/vite.config.js" ]; then
    echo "ERROR: vite.config.js not found in frontend/. The scheduler requires it."
    exit 1
fi

echo "== Registering systemd service =="
NPM_BIN="$(command -v npm)"

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null << EOF
[Unit]
Description=Dracarys FX Pro scheduler (paper trading + daily reports)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}/frontend
ExecStart=${NPM_BIN} run scheduler
Restart=always
RestartSec=5
User=$(whoami)
Environment=NODE_ENV=production
StandardOutput=append:${PROJECT_DIR}/frontend/data/scheduler.log
StandardError=append:${PROJECT_DIR}/frontend/data/scheduler.error.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# Post-start health check
sleep 3
if ! sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "ERROR: scheduler service failed to start. Check logs with:"
    echo "  sudo systemctl status ${SERVICE_NAME}"
    echo "  journalctl -u ${SERVICE_NAME} -n 50"
    exit 1
fi

echo ""
echo "Done. The scheduler is now running as a systemd service that:"
echo "  - starts automatically on VM boot"
echo "  - restarts automatically if it crashes"
echo "  - keeps running whether or not you're connected via SSH"
echo ""
echo "IMPORTANT (e2-micro is only 1GB RAM, less than the Oracle Ampere"
echo "option): if npm install or the scheduler itself gets OOM-killed,"
echo "add swap space as a safety margin:"
echo "  sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile"
echo "  sudo mkswap /swapfile && sudo swapon /swapfile"
echo "  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
echo ""
echo "Check status:   sudo systemctl status ${SERVICE_NAME}"
echo "Live logs:      journalctl -u ${SERVICE_NAME} -f"
echo "Stop it:        sudo systemctl stop ${SERVICE_NAME}"
