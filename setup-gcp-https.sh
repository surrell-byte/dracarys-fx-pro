#!/usr/bin/env bash
# Run this ON the GCP VM, after setup-gcp-reports-server.sh is already
# running (dracarys-reports.service active on port 8787).
#
# Uses nip.io: a free DNS service where "34-55-36-119.nip.io" resolves to
# 34.55.36.119 automatically - no domain purchase, no account, no config.
# Let's Encrypt (via Caddy) can issue a real trusted certificate for that
# hostname because it's a real DNS record, even though you don't own it.
# Caddy handles the whole cert request/renewal process automatically.
set -euo pipefail

PUBLIC_IP="$(curl -s -4 ifconfig.me)"
NIP_DOMAIN="$(echo "$PUBLIC_IP" | tr '.' '-').nip.io"

echo "== Detected public IP: ${PUBLIC_IP} =="
echo "== HTTPS domain will be: ${NIP_DOMAIN} =="
echo ""

echo "== Opening firewall port 443 (HTTPS) =="
if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow 443/tcp || true
fi

echo ""
echo "IMPORTANT - same as before, GCP's network-level firewall needs a"
echo "rule too, separate from ufw. Do ONE of:"
echo ""
echo "  Option A (from your Mac, if gcloud CLI installed):"
echo "    gcloud compute firewall-rules create allow-https \\"
echo "      --allow=tcp:443 --source-ranges=0.0.0.0/0"
echo ""
echo "  Option B (Console): VPC network -> Firewall -> Create Firewall Rule"
echo "    Targets: All instances in the network"
echo "    Source IPv4 ranges: 0.0.0.0/0"
echo "    Protocols/ports: tcp:443"
echo ""
read -p "Press Enter once that firewall rule exists (or if it's already done)..."

echo "== Installing Caddy =="
if ! command -v caddy >/dev/null 2>&1; then
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt-get update
    sudo apt-get install -y caddy
else
    echo "Caddy already installed."
fi

echo "== Writing Caddyfile (reverse proxy 443 -> localhost:8787) =="
# Back up existing Caddyfile if present
if [ -f /etc/caddy/Caddyfile ]; then
    sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
fi

sudo tee /etc/caddy/Caddyfile > /dev/null << EOF
${NIP_DOMAIN} {
	reverse_proxy localhost:8787
}
EOF

sudo systemctl restart caddy
sudo systemctl enable caddy

echo ""
echo "Done. Caddy will request a certificate for ${NIP_DOMAIN} on first"
echo "request - this can take up to ~30 seconds the very first time you"
echo "visit it."
echo ""
echo "Your HTTPS reports URL is now:"
echo "  https://${NIP_DOMAIN}"
echo ""
echo "This is the URL to use in the Vercel dashboard's API calls (see"
echo "the dashboard setup script) - it replaces the old"
echo "http://${PUBLIC_IP}:8787 URL, which still works but isn't secure"
echo "and won't be fetchable from your HTTPS Vercel site."
echo ""
echo "Verify certificate:"
echo "  curl -sI https://${NIP_DOMAIN} | head -5"
echo ""
echo "Check status:  sudo systemctl status caddy"
echo "Live logs:     journalctl -u caddy -f"
