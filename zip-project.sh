#!/bin/bash
set -e

# Run this from inside ~/Downloads/dracarys-fx-pro
PROJECT_DIR="$(pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ZIP_NAME="${PROJECT_NAME}-${TIMESTAMP}.zip"
DEST="$HOME/${ZIP_NAME}"

cd "$(dirname "$PROJECT_DIR")"

zip -r "$DEST" "$PROJECT_NAME" \
  -x "${PROJECT_NAME}/node_modules/*" \
  -x "${PROJECT_NAME}/frontend/node_modules/*" \
  -x "${PROJECT_NAME}/backend/node_modules/*" \
  -x "${PROJECT_NAME}/.git/*" \
  -x "${PROJECT_NAME}/frontend/dist/*" \
  -x "*.DS_Store" \
  -x "*.env" \
  -x "*.env.*" \
  -x "${PROJECT_NAME}/frontend/data/*" \
  -x "${PROJECT_NAME}/frontend/reports/*" \
  -x "${PROJECT_NAME}/data/*" \
  -x "${PROJECT_NAME}/reports/*" \
  -x "*.bak" \
  -x "*.sqlite" \
  -x "*.sqlite3" \
  -x "*.db"

echo ""
echo "⚠️  Verifying no secrets made it into the archive..."
if unzip -l "$DEST" | grep -qiE '\.env(\.|$)|\.bak$|\.sqlite|\.db$'; then
    echo "❌  Potential secret/data files found in the archive! Aborting - inspect zip contents:"
    unzip -l "$DEST" | grep -iE '\.env(\.|$)|\.bak$|\.sqlite|\.db$'
    rm -f "$DEST"
    exit 1
fi
echo "✅  No .env, .bak, or database files found in the archive."

echo "Created: $DEST"
ls -lh "$DEST"
