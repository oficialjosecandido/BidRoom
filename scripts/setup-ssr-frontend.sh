#!/bin/bash
# BidRoom — Migrate frontend from Azure Static Web Apps to App Service (Node SSR)
#
# This script provisions the App Service, configures settings, and walks you through
# the custom-domain/DNS cutover from the old SWA to the new SSR node.
#
# Prerequisites:
#   - az login (Azure CLI, version ≥ 2.50)
#   - The GitHub Actions workflow deploy-frontend.yml already updated (done in Phase 3/4)
#   - Backend App Service bidroom-backend-dev already running
#   - GitHub Secrets already set (reused from backend workflow):
#       AZURE_CREDENTIALS  — service principal JSON with Contributor on bidroom-dev-rg
#       STRIPE_PUBLISHABLE_KEY — Stripe pk_live_… key
#
# Usage: ./scripts/setup-ssr-frontend.sh

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
RESOURCE_GROUP="bidroom-dev-rg"
PLAN_NAME="bidroom-dev-plan"          # existing plan shared with backend
APP_NAME="bidroom-frontend-dev"       # new App Service (different resource type from the SWA of same name)
OLD_SWA_NAME="bidroom-frontend-dev"   # existing SWA to be retired after cutover
CUSTOM_DOMAIN="www.bidroom.pt"
BACKEND_URL="https://bidroom-backend-dev.azurewebsites.net"
REGION="eastus"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
err()  { echo -e "${RED}❌  $1${NC}"; exit 1; }
info() { echo -e "${BLUE}ℹ️   $1${NC}"; }

# ── Pre-flight ──────────────────────────────────────────────────────────────────
command -v az &>/dev/null || err "Azure CLI not installed. See https://aka.ms/installazurecli"
az account show &>/dev/null || err "Not logged in — run: az login"

SUB=$(az account show --query name -o tsv)
info "Subscription: $SUB"
info "Resource group: $RESOURCE_GROUP"

# Create resource group if it doesn't exist
if ! az group show -n "$RESOURCE_GROUP" &>/dev/null; then
  info "Resource group $RESOURCE_GROUP not found - creating in ${REGION}..."
  az group create -n "$RESOURCE_GROUP" -l "$REGION" -o table
  ok "Resource group created"
else
  ok "Resource group $RESOURCE_GROUP already exists"
fi
echo ""

# ── 1. App Service Plan ─────────────────────────────────────────────────────────
echo "── 1/6  App Service Plan ───────────────────────────────────────────────────"
if az appservice plan show -n "$PLAN_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  CURRENT_SKU=$(az appservice plan show -n "$PLAN_NAME" -g "$RESOURCE_GROUP" --query sku.name -o tsv)
  ok "Plan $PLAN_NAME already exists (SKU: $CURRENT_SKU)"
  if [[ "$CURRENT_SKU" == "F1" ]]; then
    warn "Plan is on Free tier — SSR requires at least B1 (no Always On on F1)."
    warn "Upgrade: az appservice plan update -n $PLAN_NAME -g $RESOURCE_GROUP --sku B1"
  fi
else
  info "Creating App Service Plan $PLAN_NAME (B2, Linux)…"
  az appservice plan create \
    -n "$PLAN_NAME" -g "$RESOURCE_GROUP" \
    --location "$REGION" --is-linux --sku B2 -o table
  ok "Plan created"
fi
echo ""

# ── 2. Web App ──────────────────────────────────────────────────────────────────
echo "── 2/6  App Service (Node SSR) ─────────────────────────────────────────────"
if az webapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  warn "App Service $APP_NAME already exists — skipping creation"
else
  info "Creating App Service $APP_NAME (Node 20 LTS, Linux)…"
  az webapp create \
    -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --plan "$PLAN_NAME" --runtime "NODE:22-lts" -o table
  ok "App Service created: https://$APP_NAME.azurewebsites.net"
fi
echo ""

# ── 3. App Settings ─────────────────────────────────────────────────────────────
echo "── 3/6  App Settings ───────────────────────────────────────────────────────"
az webapp config appsettings set \
  -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV=production \
    WEBSITE_NODE_DEFAULT_VERSION="20.x" \
    NG_ALLOWED_HOSTS="$APP_NAME.azurewebsites.net,bidroom.pt" \
    SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  -o table
ok "App settings configured"

az webapp config set \
  -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --always-on true \
  --http20-enabled true \
  --web-sockets-enabled false \
  --startup-file "node server/server.mjs" \
  -o table
ok "App config set (always-on, HTTP/2, startup command)"

az webapp update \
  -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --https-only true -o none
ok "HTTPS-only enforced"
echo ""

# ── 4. Trigger first deployment ──────────────────────────────────────────────────
echo "── 4/6  First Deployment ───────────────────────────────────────────────────"
info "Push to main (or dev) on GitHub to trigger the deploy-frontend.yml workflow."
info "Or run a workflow_dispatch from: https://github.com/oficialjosecandido/BidRoom/actions"
echo ""
info "Waiting for you to confirm the workflow succeeded…"
echo ""
read -p "  Press Enter once the GitHub Actions deploy has completed → "
echo ""

# Smoke-test the azurewebsites.net URL
SSR_URL="https://$APP_NAME.azurewebsites.net"
info "Smoke-testing $SSR_URL/listing/ …"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SSR_URL/listing/test-slug" --max-time 15 || echo "000")
if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "302" ]]; then
  ok "Server is responding ($HTTP_CODE)"
else
  warn "Got HTTP $HTTP_CODE — check App Service logs:"
  warn "  az webapp log tail -n $APP_NAME -g $RESOURCE_GROUP"
fi
echo ""

# ── 5. Custom Domain + TLS ──────────────────────────────────────────────────────
echo "── 5/6  Custom Domain (www.bidroom.pt) ─────────────────────────────────────"

# Get domain verification ID
VERIFY_ID=$(az webapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --query customDomainVerificationId -o tsv)

echo ""
echo "  Add these DNS records at your registrar BEFORE proceeding:"
echo ""
echo "  ┌──────────────────────────────────────────────────────────────────────┐"
echo "  │  Type  │  Host                   │  Value                            │"
echo "  ├──────────────────────────────────────────────────────────────────────┤"
echo "  │  CNAME │  www                    │  $APP_NAME.azurewebsites.net      │"
echo "  │  TXT   │  asuid.www              │  $VERIFY_ID                       │"
echo "  └──────────────────────────────────────────────────────────────────────┘"
echo ""
warn "Remove the custom domain from the old SWA FIRST (Azure portal → Static Web Apps → $OLD_SWA_NAME → Custom domains → delete www.bidroom.pt)"
warn "Then update your CNAME, wait for propagation (use: dig CNAME www.bidroom.pt), then press Enter."
echo ""
read -p "  Press Enter once DNS propagation is confirmed → "
echo ""

info "Binding custom domain ${CUSTOM_DOMAIN} to ${APP_NAME}..."
az webapp config hostname add \
  --webapp-name "$APP_NAME" -g "$RESOURCE_GROUP" \
  --hostname "$CUSTOM_DOMAIN" -o table
ok "Custom domain added"

info "Creating managed TLS certificate…"
CERT_THUMB=$(az webapp config ssl create \
  -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --hostname "$CUSTOM_DOMAIN" \
  --query thumbprint -o tsv)
ok "Certificate created (thumbprint: ${CERT_THUMB:0:16}…)"

info "Binding TLS certificate…"
az webapp config ssl bind \
  -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --certificate-thumbprint "$CERT_THUMB" \
  --ssl-type SNI -o table
ok "TLS bound — $CUSTOM_DOMAIN now uses managed HTTPS"
echo ""

# ── 6. Final validation ──────────────────────────────────────────────────────────
echo "── 6/6  Final Validation ───────────────────────────────────────────────────"
PROD_URL="https://$CUSTOM_DOMAIN"

echo ""
info "Checking OG tags on a listing page…"
OG_TITLE=$(curl -sL "$PROD_URL/listing/rolex-datejust-blue-dial-41mm-2026" --max-time 10 \
  | grep -oP 'property="og:title" content="\K[^"]+' || echo "(not found)")
if [[ "$OG_TITLE" == *"BidRoom -"* ]]; then
  ok "OG title correct: $OG_TITLE"
else
  warn "OG title: $OG_TITLE — check if slug exists in production"
fi

echo ""
echo "══════════════════════════════════════════════════════════════════════════"
ok "Phase 4 complete — SSR is live on $PROD_URL"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  App Service:  https://portal.azure.com (App Services → $APP_NAME)"
echo "  Logs:         az webapp log tail -n $APP_NAME -g $RESOURCE_GROUP"
echo "  Redeploy:     push to main or use workflow_dispatch"
echo ""
echo "  Retire the old SWA once stable:"
echo "  az staticwebapp delete -n $OLD_SWA_NAME -g $RESOURCE_GROUP"
echo ""
