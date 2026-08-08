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
  -x "*.DS_Store"

echo "Created: $DEST"
ls -lh "$DEST"
