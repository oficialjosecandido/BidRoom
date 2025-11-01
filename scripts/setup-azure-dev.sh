#!/bin/bash

# Azure Dev Environment Setup Script for BidRoom
# This script creates all Azure resources for the dev environment
# Usage: ./scripts/setup-azure-dev.sh

set -e

echo "🚀 Setting up Azure Dev Environment for BidRoom..."

# Configuration
RESOURCE_GROUP="bidroom-dev-rg"
LOCATION="East US"
APP_SERVICE_PLAN="bidroom-dev-plan"
WEB_APP_NAME="bidroom-backend-dev"
STATIC_WEB_APP_NAME="bidroom-frontend-dev"
REDIS_CACHE_NAME="bidroom-dev-redis"
GITHUB_REPO="https://github.com/oficialjosecandido/BidRoom"  # Update if different

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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
    print_error "Azure CLI is not installed. Please install it first: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

# Check if user is logged in
if ! az account show &> /dev/null; then
    print_error "You are not logged in to Azure CLI. Please run 'az login' first."
    exit 1
fi

print_status "Azure CLI is installed and you are logged in."

# Get current subscription
SUBSCRIPTION=$(az account show --query name -o tsv)
print_info "Using Azure subscription: $SUBSCRIPTION"

# Create resource group
echo ""
echo "📦 Creating resource group..."
if az group show --name $RESOURCE_GROUP &> /dev/null; then
    print_warning "Resource group $RESOURCE_GROUP already exists. Skipping creation."
else
    az group create --name $RESOURCE_GROUP --location "$LOCATION" --output table
    print_status "Resource group created: $RESOURCE_GROUP"
fi

# Create App Service Plan
echo ""
echo "🏗️  Creating App Service Plan..."
if az appservice plan show --name $APP_SERVICE_PLAN --resource-group $RESOURCE_GROUP &> /dev/null; then
    print_warning "App Service Plan $APP_SERVICE_PLAN already exists. Skipping creation."
else
    az appservice plan create \
        --name $APP_SERVICE_PLAN \
        --resource-group $RESOURCE_GROUP \
        --sku B1 \
        --is-linux \
        --output table
    print_status "App Service Plan created: $APP_SERVICE_PLAN"
fi

# Create Redis Cache (Azure Cache for Redis)
echo ""
echo "🔴 Creating Azure Cache for Redis..."
if az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    print_warning "Redis Cache $REDIS_CACHE_NAME already exists. Skipping creation."
    REDIS_HOST=$(az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query hostName -o tsv)
    REDIS_PORT=$(az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query port -o tsv)
    REDIS_SSL_PORT=$(az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query sslPort -o tsv)
else
    print_info "Creating Redis Cache (this may take 15-20 minutes)..."
    az redis create \
        --name $REDIS_CACHE_NAME \
        --resource-group $RESOURCE_GROUP \
        --location "$LOCATION" \
        --sku Basic \
        --vm-size c0 \
        --output table
    
    # Wait for Redis to be ready
    print_info "Waiting for Redis Cache to be ready..."
    az redis wait --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --created
    
    REDIS_HOST=$(az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query hostName -o tsv)
    REDIS_PORT=$(az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query port -o tsv)
    REDIS_SSL_PORT=$(az redis show --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query sslPort -o tsv)
    print_status "Redis Cache created: $REDIS_CACHE_NAME"
fi

REDIS_PRIMARY_KEY=$(az redis list-keys --name $REDIS_CACHE_NAME --resource-group $RESOURCE_GROUP --query primaryKey -o tsv)
print_status "Redis connection info retrieved"

# Create Web App for backend
echo ""
echo "🌐 Creating Web App for backend..."
if az webapp show --name $WEB_APP_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    print_warning "Web App $WEB_APP_NAME already exists. Skipping creation."
else
    az webapp create \
        --resource-group $RESOURCE_GROUP \
        --plan $APP_SERVICE_PLAN \
        --name $WEB_APP_NAME \
        --runtime "NODE:20-lts" \
        --output table
    print_status "Web App created: $WEB_APP_NAME"
fi

# Enable Web Sockets for Socket.io
echo ""
echo "🔌 Enabling Web Sockets..."
az webapp config set \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --web-sockets-enabled true \
    --output table
print_status "Web Sockets enabled"

# Create Static Web App for frontend
echo ""
echo "📱 Creating Static Web App for frontend..."
if az staticwebapp show --name $STATIC_WEB_APP_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    print_warning "Static Web App $STATIC_WEB_APP_NAME already exists."
    FRONTEND_URL=$(az staticwebapp show --name $STATIC_WEB_APP_NAME --resource-group $RESOURCE_GROUP --query defaultHostname -o tsv)
    FRONTEND_URL="https://$FRONTEND_URL"
else
    print_info "Creating Static Web App (requires GitHub repository)..."
    az staticwebapp create \
        --name $STATIC_WEB_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --source $GITHUB_REPO \
        --location "East US 2" \
        --branch main \
        --app-location "/frontend" \
        --output-location "dist/frontend/browser" \
        --login-with-github \
        --output table
    print_status "Static Web App created: $STATIC_WEB_APP_NAME"
    
    # Wait a bit for the Static Web App to be fully provisioned
    sleep 10
    
    FRONTEND_URL=$(az staticwebapp show --name $STATIC_WEB_APP_NAME --resource-group $RESOURCE_GROUP --query defaultHostname -o tsv)
    FRONTEND_URL="https://$FRONTEND_URL"
fi

BACKEND_URL="https://$WEB_APP_NAME.azurewebsites.net"

# Get deployment token for Static Web App
echo ""
echo "🔑 Getting deployment token..."
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name $STATIC_WEB_APP_NAME --resource-group $RESOURCE_GROUP --query properties.apiKey -o tsv 2>/dev/null || echo "")
if [ -z "$DEPLOYMENT_TOKEN" ]; then
    print_warning "Could not retrieve deployment token. You may need to set it up in Azure Portal."
else
    print_status "Deployment token retrieved"
fi

# Get publish profile for Web App
echo ""
echo "📄 Getting publish profile..."
az webapp deployment list-publishing-profiles \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --xml > backend-publish-profile.xml 2>/dev/null || print_warning "Could not save publish profile"
print_status "Publish profile saved to backend-publish-profile.xml"

# Display summary and next steps
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "🎉 Azure resources created successfully!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📋 Resource Information:"
echo ""
echo "   Resource Group:    $RESOURCE_GROUP"
echo "   Backend URL:       $BACKEND_URL"
echo "   Frontend URL:      $FRONTEND_URL"
echo "   Redis Host:        $REDIS_HOST"
echo "   Redis Port:        $REDIS_PORT (non-SSL), $REDIS_SSL_PORT (SSL)"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📋 Next Steps:"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "1. Configure Backend Environment Variables:"
echo ""
echo "   Run the setup script:"
echo "   ./scripts/configure-azure-env.sh"
echo ""
echo "   Or manually in Azure Portal:"
echo "   https://portal.azure.com → App Services → $WEB_APP_NAME → Configuration"
echo ""
echo "   Required settings:"
echo "     NODE_ENV=development"
echo "     PORT=3000"
echo "     MONGO_URI=<your-mongodb-connection-string>"
echo "     JWT_SECRET=<your-jwt-secret>"
echo "     FRONTEND_URL=$FRONTEND_URL"
echo "     REDIS_HOST=$REDIS_HOST"
echo "     REDIS_PORT=$REDIS_SSL_PORT"
echo "     REDIS_PASSWORD=$REDIS_PRIMARY_KEY"
echo ""
echo "2. Configure Frontend (Static Web App):"
echo ""
echo "   Set environment variable in Azure Portal:"
echo "   https://portal.azure.com → Static Web Apps → $STATIC_WEB_APP_NAME → Configuration"
echo ""
echo "   Add application setting:"
echo "     VITE_API_URL=$BACKEND_URL"
echo "     (or configure in build process)"
echo ""
echo "3. Deploy Backend:"
echo ""
echo "   Option A - Using Azure CLI:"
echo "   cd backend && zip -r ../backend-deploy.zip . && cd .."
echo "   az webapp deploy --resource-group $RESOURCE_GROUP --name $WEB_APP_NAME --src-path backend-deploy.zip --type zip"
echo ""
echo "   Option B - Using GitHub Actions (if configured)"
echo ""
echo "4. Frontend will auto-deploy when you push to main branch"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "🔗 Useful Links:"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "   Azure Portal:    https://portal.azure.com"
echo "   Backend:         $BACKEND_URL"
echo "   Frontend:        $FRONTEND_URL"
echo "   Resource Group:  https://portal.azure.com/#@/resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP"
echo ""
echo "═══════════════════════════════════════════════════════════════"
print_warning "Important: Remember to set all environment variables in Azure Portal before deploying!"
echo ""
