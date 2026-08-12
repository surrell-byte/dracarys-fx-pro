#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ZIP_NAME="${PROJECT_NAME}-${TIMESTAMP}.zip"
DEST="$HOME/${ZIP_NAME}"

cd "$(dirname "$PROJECT_DIR")"

echo "📦 Creating: $ZIP_NAME"

zip -r "$DEST" "$PROJECT_NAME" \
  -x "${PROJECT_NAME}/node_modules/*" \
  -x "${PROJECT_NAME}/frontend/node_modules/*" \
  -x "${PROJECT_NAME}/backend/node_modules/*" \
  -x "${PROJECT_NAME}/.git/*" \
  -x "${PROJECT_NAME}/frontend/dist/*" \
  -x "${PROJECT_NAME}/dist/*" \
  -x "*.DS_Store" \
  -x "*/.env" \
  -x "*/.env.*" \
  -x "*.bak" \
  -x "*.sqlite" \
  -x "*.sqlite3" \
  -x "*.db" \
  -x "*.db-wal" \
  -x "*.db-shm" \
  -x "${PROJECT_NAME}/frontend/data/*" \
  -x "${PROJECT_NAME}/frontend/reports/*" \
  -x "${PROJECT_NAME}/data/*" \
  -x "${PROJECT_NAME}/reports/*" \
  -x "${PROJECT_NAME}/.dracarys-fix-backup-*/*" \
  -x "${PROJECT_NAME}/archive/*"

echo ""
echo "🔍 Verifying archive..."

SECRET_FILES="$(unzip -Z1 "$DEST" | grep -Ei '(^|/)\.env($|\.)|\.sqlite3?$|\.db(-wal|-shm)?$|\.bak$' || true)"

if [ -n "$SECRET_FILES" ]; then
    echo ""
    echo "❌ SECRET / DATA FILES FOUND:"
    echo "$SECRET_FILES"
    echo ""
    rm -f "$DEST"
    exit 1
fi

echo "✅ No .env, database, or backup files found."

echo ""
echo "📊 Archive size:"
ls -lh "$DEST"

echo ""
echo "📁 Archive contents:"
unzip -Z1 "$DEST" | head -40

echo ""
echo "✅ ZIP created successfully:"
echo "$DEST"
