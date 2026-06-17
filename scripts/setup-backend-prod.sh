#!/bin/bash
# BidRoom — Create bidroom-backend-prod App Service
#
# Provisions a production backend App Service in the existing bidroom-dev-rg
# resource group. The GitHub Actions workflow deploy-backend-prod.yml deploys
# to this App Service whenever ericeira-prod is pushed.
#
# Prerequisites:
#   - az login
#   - setup-ssr-frontend.sh already run (creates bidroom-dev-rg + bidroom-dev-plan)
#   - Backend environment variables ready (see list below)
#
# Usage: ./scripts/setup-backend-prod.sh

set -euo pipefail

RESOURCE_GROUP="bidroom-dev-rg"
PLAN_NAME="bidroom-dev-plan"
APP_NAME="bidroom-backend-prod"
REGION="eastus"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}OK  $1${NC}"; }
warn() { echo -e "${YELLOW}--  $1${NC}"; }
info() { echo -e "${BLUE}>>  $1${NC}"; }
err()  { echo -e "${RED}!!  $1${NC}"; exit 1; }

command -v az &>/dev/null || err "Azure CLI not installed"
az account show &>/dev/null || err "Not logged in - run: az login"

SUB=$(az account show --query name -o tsv)
info "Subscription: ${SUB}"
echo ""

# ── 1. Resource group (should already exist) ───────────────────────────────────
if ! az group show -n "$RESOURCE_GROUP" &>/dev/null; then
  info "Creating resource group ${RESOURCE_GROUP} in ${REGION}..."
  az group create -n "$RESOURCE_GROUP" -l "$REGION" -o table
  ok "Resource group created"
else
  ok "Resource group ${RESOURCE_GROUP} exists"
fi

# ── 2. App Service Plan (should already exist) ─────────────────────────────────
if ! az appservice plan show -n "$PLAN_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  info "Creating App Service Plan ${PLAN_NAME} (B2, Linux)..."
  az appservice plan create \
    -n "$PLAN_NAME" -g "$RESOURCE_GROUP" \
    --location "$REGION" --is-linux --sku B2 -o table
  ok "Plan created"
else
  ok "Plan ${PLAN_NAME} exists"
fi

# ── 3. Create backend prod App Service ─────────────────────────────────────────
echo ""
echo "-- App Service: ${APP_NAME} -------------------------------------------"
if az webapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  warn "App Service ${APP_NAME} already exists - skipping creation"
else
  info "Creating App Service ${APP_NAME} (Node 22 LTS, Linux)..."
  az webapp create \
    -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --plan "$PLAN_NAME" --runtime "NODE:22-lts" -o table
  ok "App Service created: https://${APP_NAME}.azurewebsites.net"
fi

# ── 4. Configure ───────────────────────────────────────────────────────────────
echo ""
info "Configuring App Service..."

az webapp config set \
  -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --always-on true \
  --http20-enabled true \
  --web-sockets-enabled true \
  --startup-file "" \
  -o table

az webapp update \
  -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --https-only true -o none

ok "App Service configured (always-on, HTTPS-only, WebSockets)"

# ── 5. Base app settings (non-secret) ─────────────────────────────────────────
echo ""
info "Setting base app settings..."
az webapp config appsettings set \
  -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV=production \
    PORT=8080 \
    WEBSITE_NODE_DEFAULT_VERSION="22.x" \
    SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  -o table
ok "Base settings applied"

# ── 6. Secret environment variables ───────────────────────────────────────────
echo ""
echo "==========================================================================="
warn "ACTION REQUIRED: Set secret environment variables in Azure Portal"
echo "==========================================================================="
echo ""
echo "  Portal URL:"
echo "  https://portal.azure.com/#@/resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Web/sites/${APP_NAME}/config"
echo ""
echo "  Or via CLI (fill in values):"
echo ""
echo "  az webapp config appsettings set \\"
echo "    -n ${APP_NAME} -g ${RESOURCE_GROUP} \\"
echo "    --settings \\"
echo "      MONGO_URI='<mongodb+srv://...>' \\"
echo "      JWT_SECRET='<strong-random-secret>' \\"
echo "      FRONTEND_URL='https://www.bidroom.pt' \\"
echo "      STRIPE_SECRET_KEY='<sk_live_...>' \\"
echo "      STRIPE_WEBHOOK_SECRET='<whsec_...>' \\"
echo "      FIREBASE_PROJECT_ID='<project-id>' \\"
echo "      FIREBASE_PRIVATE_KEY='<-----BEGIN PRIVATE KEY----->...' \\"
echo "      FIREBASE_CLIENT_EMAIL='<firebase-adminsdk-...>' \\"
echo "      REDIS_HOST='<host>' \\"
echo "      REDIS_PORT='6380' \\"
echo "      REDIS_PASSWORD='<password>'"
echo ""
echo "==========================================================================="
echo ""
read -p "  Press Enter once you have set the environment variables -> "

# ── 7. Smoke-test ──────────────────────────────────────────────────────────────
echo ""
info "Smoke-testing https://${APP_NAME}.azurewebsites.net/health..."

# Restart to pick up any newly applied settings
az webapp restart -n "$APP_NAME" -g "$RESOURCE_GROUP" -o none

sleep 5

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://${APP_NAME}.azurewebsites.net/health" --max-time 20 || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  ok "Backend is healthy (HTTP 200)"
elif [[ "$HTTP_CODE" == "000" ]]; then
  warn "No response yet - app may still be starting. Check logs:"
  warn "  az webapp log tail -n ${APP_NAME} -g ${RESOURCE_GROUP}"
else
  warn "Got HTTP ${HTTP_CODE} - check app settings and logs:"
  warn "  az webapp log tail -n ${APP_NAME} -g ${RESOURCE_GROUP}"
fi

# ── 8. Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "==========================================================================="
ok "bidroom-backend-prod is provisioned"
echo "==========================================================================="
echo ""
echo "  URL:        https://${APP_NAME}.azurewebsites.net"
echo "  Logs:       az webapp log tail -n ${APP_NAME} -g ${RESOURCE_GROUP}"
echo "  Deploy:     push to ericeira-prod branch (or workflow_dispatch)"
echo "              .github/workflows/deploy-backend-prod.yml"
echo ""
echo "  Update frontend to use this backend:"
echo "  GitHub -> Settings -> Variables -> API_URL ="
echo "  https://${APP_NAME}.azurewebsites.net"
echo ""
