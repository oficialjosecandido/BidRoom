#!/bin/bash

# Deploy Backend to Azure App Service
# This script builds and deploys the backend to Azure
# Usage: ./scripts/deploy-backend-azure.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
DEPLOY_ZIP="$PROJECT_ROOT/backend-deploy.zip"
AZURE_WEBAPP_NAME="bidroom-backend-dev"
RESOURCE_GROUP="bidroom-dev-rg"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    print_error "Azure CLI is not installed. Please install it first."
    exit 1
fi

# Check if user is logged in
if ! az account show &> /dev/null; then
    print_error "You are not logged in to Azure CLI. Please run 'az login' first."
    exit 1
fi

echo "🚀 Deploying Backend to Azure..."

# Step 1: Clean old deployment package
echo ""
echo "🧹 Cleaning old deployment package..."
if [ -f "$DEPLOY_ZIP" ]; then
    rm "$DEPLOY_ZIP"
fi

# Step 2: Create deployment package
echo ""
echo "📦 Creating deployment package..."
cd "$BACKEND_DIR"

# Create a clean package excluding unnecessary files
zip -r "$DEPLOY_ZIP" . \
    -x "*.git*" \
    -x "*node_modules*" \
    -x "*.log" \
    -x "*.env" \
    -x "*.example" \
    -x "*.md" \
    -x "*test*" \
    -x "*.test.js" \
    -x "*.spec.js" \
    -q

print_status "Deployment package created: $DEPLOY_ZIP"
echo "   Package size: $(du -h "$DEPLOY_ZIP" | cut -f1)"

# Step 3: Deploy to Azure
echo ""
echo "🚀 Deploying to Azure App Service..."
cd "$PROJECT_ROOT"
az webapp deploy \
    --resource-group "$RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --src-path "$DEPLOY_ZIP" \
    --type zip \
    --output table

print_status "Deployment completed!"

# Step 4: Restart the app
echo ""
echo "🔄 Restarting App Service..."
az webapp restart \
    --resource-group "$RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --output table

print_status "App Service restarted"

# Step 5: Show logs
echo ""
echo "📋 Recent logs (last 10 lines):"
az webapp log tail \
    --resource-group "$RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --output table 2>/dev/null || print_warning "Could not retrieve logs"

echo ""
echo "═══════════════════════════════════════════════════════════════"
print_status "Backend deployed successfully!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "🌐 Your backend is available at:"
echo "   https://$AZURE_WEBAPP_NAME.azurewebsites.net"
echo ""
echo "📊 View logs in Azure Portal:"
echo "   https://portal.azure.com → App Services → $AZURE_WEBAPP_NAME → Log stream"
echo ""
echo "🧪 Test the API:"
echo "   curl https://$AZURE_WEBAPP_NAME.azurewebsites.net/health"
echo ""

