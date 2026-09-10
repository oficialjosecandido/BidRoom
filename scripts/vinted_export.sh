#!/usr/bin/env bash
# Import Vinted marketplace CSV + zip images into BidRoom.
# Usage (from repo root):
#   ./scripts/vinted_export.sh
#   ./scripts/vinted_export.sh --dry-run
#   ./scripts/vinted_export.sh --limit 3
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
exec node src/scripts/vinted_export.js "$@"
