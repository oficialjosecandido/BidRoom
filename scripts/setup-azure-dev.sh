#!/bin/bash

# Azure Dev Environment Setup Script for BidRoom
# This script helps set up the Azure resources for development

set -e

echo "🚀 Setting up Azure Dev Environment for BidRoom..."

# Configuration
RESOURCE_GROUP="bidroom-dev-rg"
LOCATION="East US"
APP_SERVICE_PLAN="bidroom-dev-plan"
WEB_APP_NAME="bidroom-backend-dev"
STATIC_WEB_APP_NAME="bidroom-frontend-dev"
GITHUB_REPO="https://github.com/yourusername/bidroom"  # Update this with your actual repo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Create resource group
echo "📦 Creating resource group..."
az group create --name $RESOURCE_GROUP --location "$LOCATION" --output table
print_status "Resource group created: $RESOURCE_GROUP"

# Create App Service Plan
echo "🏗️  Creating App Service Plan..."
az appservice plan create \
    --name $APP_SERVICE_PLAN \
    --resource-group $RESOURCE_GROUP \
    --sku B1 \
    --is-linux \
    --output table
print_status "App Service Plan created: $APP_SERVICE_PLAN"

# Create Web App for backend
echo "🌐 Creating Web App for backend..."
az webapp create \
    --resource-group $RESOURCE_GROUP \
    --plan $APP_SERVICE_PLAN \
    --name $WEB_APP_NAME \
    --runtime "NODE:20-lts" \
    --output table
print_status "Web App created: $WEB_APP_NAME"

# Create Static Web App for frontend
echo "📱 Creating Static Web App for frontend..."
az staticwebapp create \
    --name $STATIC_WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --source $GITHUB_REPO \
    --location "East US 2" \
    --branch dev \
    --app-location "/frontend" \
    --output-location "dist/frontend" \
    --output table
print_status "Static Web App created: $STATIC_WEB_APP_NAME"

# Get deployment token for Static Web App
echo "🔑 Getting deployment token..."
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name $STATIC_WEB_APP_NAME --resource-group $RESOURCE_GROUP --query "properties.apiKey" -o tsv)
print_status "Deployment token retrieved"

# Get publish profile for Web App
echo "📄 Getting publish profile..."
az webapp deployment list-publishing-profiles --name $WEB_APP_NAME --resource-group $RESOURCE_GROUP --xml > publish-profile.xml
print_status "Publish profile saved to publish-profile.xml"

# Display next steps
echo ""
echo "🎉 Azure resources created successfully!"
echo ""
echo "📋 Next Steps:"
echo "1. Update your GitHub repository secrets:"
echo "   - AZURE_WEBAPP_PUBLISH_PROFILE: Copy content from publish-profile.xml"
echo "   - AZURE_STATIC_WEB_APPS_API_TOKEN: $DEPLOYMENT_TOKEN"
echo ""
echo "2. Set up environment variables in Azure Portal:"
echo "   - Go to App Services → $WEB_APP_NAME → Configuration"
echo "   - Add the following application settings:"
echo "     NODE_ENV=development"
echo "     MONGO_URI=your-mongodb-connection-string"
echo "     JWT_SECRET=your-jwt-secret"
echo "     FRONTEND_URL=https://$STATIC_WEB_APP_NAME.azurestaticapps.net"
echo ""
echo "3. Update the GitHub repository URL in this script and re-run if needed"
echo ""
echo "4. Push to your dev branch to trigger deployment:"
echo "   git add ."
echo "   git commit -m 'Add Azure deployment configuration'"
echo "   git push origin dev"
echo ""
echo "🔗 Useful URLs:"
echo "   - Backend: https://$WEB_APP_NAME.azurewebsites.net"
echo "   - Frontend: https://$STATIC_WEB_APP_NAME.azurestaticapps.net"
echo "   - Azure Portal: https://portal.azure.com"
echo ""
print_warning "Remember to update the GITHUB_REPO variable in this script with your actual repository URL!"

# Clean up
rm -f publish-profile.xml
print_status "Temporary files cleaned up"
