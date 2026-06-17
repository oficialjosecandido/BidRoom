#!/bin/bash
# BidRoom — Local SSR build & smoke-test helper
#
# This script builds the Angular SSR app locally, patches runtime config, and
# runs a quick smoke-test against the local Node server.
#
# Production deployment is handled entirely by GitHub Actions:
#   .github/workflows/deploy-frontend.yml → Azure App Service bidroom-frontend-dev
#
# Usage: ./scripts/deploy-frontend-azure.sh [dev|prod]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_URL="${BACKEND_URL:-https://bidroom-backend-dev.azurewebsites.net}"
CONFIG="${1:-prod}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
info() { echo -e "${BLUE}ℹ️   $1${NC}"; }
err()  { echo -e "${RED}❌  $1${NC}"; exit 1; }

echo ""
info "BidRoom frontend — local SSR build ($CONFIG)"
echo ""

# ── 1. Install ──────────────────────────────────────────────────────────────────
info "Installing dependencies…"
cd "$FRONTEND_DIR"
npm ci --legacy-peer-deps --prefer-offline 2>/dev/null || npm ci --legacy-peer-deps
ok "Dependencies ready"

# ── 2. Build ────────────────────────────────────────────────────────────────────
info "Building Angular SSR ($CONFIG)…"
if [ "$CONFIG" = "dev" ]; then
  npx ng build --configuration=development
else
  npm run build
fi

BROWSER_HTML="$FRONTEND_DIR/dist/frontend/browser/index.csr.html"
SERVER_HTML="$FRONTEND_DIR/dist/frontend/server/index.server.html"
SERVER_MJS="$FRONTEND_DIR/dist/frontend/server/server.mjs"

[ -f "$SERVER_MJS" ]    || err "server.mjs not found — SSR build may have failed"
[ -f "$BROWSER_HTML" ]  || err "browser/index.csr.html not found"
[ -f "$SERVER_HTML" ]   || err "server/index.server.html not found"
ok "Build completed ($(du -sh "$FRONTEND_DIR/dist/frontend" | cut -f1))"

# ── 3. Patch runtime config ──────────────────────────────────────────────────────
API_URL="${BACKEND_URL}/api"
info "Patching runtime config → $API_URL"

for INDEX in "$BROWSER_HTML" "$SERVER_HTML"; do
  sed -i.bak "s|API_URL: '/api'|API_URL: '${API_URL}'|" "$INDEX"
  rm -f "$INDEX.bak"
done
ok "Patched API_URL in both HTML templates"

# ── 4. Smoke-test locally ────────────────────────────────────────────────────────
info "Starting local SSR server on port 4000…"
cd "$FRONTEND_DIR/dist/frontend"
node server/server.mjs &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

sleep 3  # give the server a moment to bind

info "Smoke-testing /listing/test-slug …"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/listing/test-slug --max-time 10 || echo "000")

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "302" ]]; then
  ok "Server is responding (HTTP $HTTP_CODE)"
else
  warn "Got HTTP $HTTP_CODE — check server output above"
fi

info "Checking OG tags (listing page)…"
curl -sL http://localhost:4000/listing/test-slug --max-time 10 \
  | grep -o 'property="og:[^>]*>' | head -5 || warn "No OG tags found (slug may not exist)"

echo ""
echo "══════════════════════════════════════════════════════════════════════════"
ok "Local build & smoke-test done"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Server running at:  http://localhost:4000   (stops when this script exits)"
echo ""
echo "  To deploy to production, push to main on GitHub:"
echo "  → .github/workflows/deploy-frontend.yml deploys to bidroom-frontend-dev.azurewebsites.net"
echo ""
read -p "  Press Enter to stop the server → "
