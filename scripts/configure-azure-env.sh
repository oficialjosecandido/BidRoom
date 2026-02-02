#!/bin/bash

# Configure Azure App Service Environment Variables
# This script sets up all required environment variables for the backend App Service
# Usage: ./scripts/configure-azure-env.sh

set -e

# Configuration
RESOURCE_GROUP="bidroom-dev-rg"
WEB_APP_NAME="bidroom-backend-dev"
STATIC_WEB_APP_NAME="bidroom-frontend-dev"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    print_error "Azure CLI is not installed."
    exit 1
fi

# Check if user is logged in
if ! az account show &> /dev/null; then
    print_error "You are not logged in to Azure CLI. Please run 'az login' first."
    exit 1
fi

# Get Redis information
echo "🔴 Getting Redis Cache information..."
REDIS_CACHE_NAME="bidroom-dev-redis"
REDIS_HOST=$(az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query hostName -o tsv 2>/dev/null || echo "")
REDIS_SSL_PORT=$(az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query sslPort -o tsv 2>/dev/null || echo "")
REDIS_PRIMARY_KEY=$(az redis list-keys --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query primaryKey -o tsv 2>/dev/null || echo "")

if [ -z "$REDIS_HOST" ]; then
    print_warning "Redis Cache not found. Please run setup-azure-dev.sh first or set REDIS_* variables manually."
fi

# Get frontend URL
FRONTEND_URL=$(az staticwebapp show --name $STATIC_WEB_APP_NAME --resource-group $RESOURCE_GROUP --query defaultHostname -o tsv 2>/dev/null || echo "")
if [ -n "$FRONTEND_URL" ]; then
    FRONTEND_URL="https://$FRONTEND_URL"
else
    FRONTEND_URL="https://$STATIC_WEB_APP_NAME.azurestaticapps.net"
    print_warning "Could not retrieve frontend URL. Using default."
fi

# Prompt for MongoDB URI
echo ""
print_info "Enter MongoDB connection string:"
read -p "MONGO_URI: " MONGO_URI
if [ -z "$MONGO_URI" ]; then
    print_error "MongoDB URI is required!"
    exit 1
fi

# Prompt for JWT Secret
echo ""
print_info "Enter JWT Secret (or press Enter to generate one):"
read -p "JWT_SECRET: " JWT_SECRET
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET=$(openssl rand -base64 32)
    print_info "Generated JWT Secret: $JWT_SECRET"
fi

# Set environment variables
echo ""
echo "🔧 Configuring Azure App Service environment variables..."

az webapp config appsettings set \
    --resource-group $RESOURCE_GROUP \
    --name $WEB_APP_NAME \
    --settings \
        NODE_ENV="development" \
        PORT="3000" \
        MONGO_URI="$MONGO_URI" \
        JWT_SECRET="$JWT_SECRET" \
        FRONTEND_URL="$FRONTEND_URL" \
        REDIS_HOST="$REDIS_HOST" \
        REDIS_PORT="$REDIS_SSL_PORT" \
        REDIS_PASSWORD="$REDIS_PRIMARY_KEY" \
    --output table

print_status "Environment variables configured successfully!"

# Restart the app
echo ""
echo "🔄 Restarting App Service..."
az webapp restart --name $WEB_APP_NAME --resource-group $RESOURCE_GROUP --output table
print_status "App Service restarted"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Configuration complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Your backend is now configured with:"
echo "   MongoDB:         ✅ Configured"
echo "   JWT Secret:      ✅ Configured"
echo "   Frontend URL:    $FRONTEND_URL"
echo "   Redis Cache:     $([ -n "$REDIS_HOST" ] && echo "✅ Connected" || echo "⚠️  Not configured")"
echo ""
echo "Backend URL: https://$WEB_APP_NAME.azurewebsites.net"
echo ""

