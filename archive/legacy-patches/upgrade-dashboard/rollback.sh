#!/usr/bin/env bash
set -euo pipefail

echo "This upgrade changes application source rather than a generated artifact."
echo "To roll it back safely, revert the Live Reports source changes in version control."
echo "No database schema migration is introduced, so no data rollback is required."
