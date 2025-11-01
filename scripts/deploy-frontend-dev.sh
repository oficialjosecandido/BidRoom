#!/bin/bash

# Deploy Frontend to Azure App Service (Dev Environment)
# This script builds the frontend and deploys it to bidroom-frontend-dev

set -e

echo "🚀 Deploying Frontend to Azure Dev Environment..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BUILD_DIR="$FRONTEND_DIR/dist/frontend/browser"
DEPLOY_ZIP="$PROJECT_ROOT/frontend-deploy.zip"
AZURE_WEBAPP_NAME="bidroom-frontend-dev"
RESOURCE_GROUP="bidroom-dev-rg"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo -e "${RED}❌ Azure CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if user is logged in
if ! az account show &> /dev/null; then
    echo -e "${RED}❌ You are not logged in to Azure CLI. Please run 'az login' first.${NC}"
    exit 1
fi

# Step 1: Clean and install dependencies
echo -e "${YELLOW}📦 Cleaning and installing dependencies...${NC}"
cd "$FRONTEND_DIR"

# Remove node_modules if it exists to ensure clean install
if [ -d "node_modules" ]; then
    echo -e "${YELLOW}🧹 Cleaning existing node_modules...${NC}"
    rm -rf node_modules
fi

# Install dependencies with legacy peer deps
npm install --legacy-peer-deps

# Verify installation by checking for key packages
if [ ! -d "node_modules/@angular/core" ]; then
    echo -e "${RED}❌ Failed to install Angular dependencies. Check npm errors above.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dependencies installed successfully${NC}"

# Step 2: Build frontend
echo -e "${YELLOW}🔨 Building frontend...${NC}"
npm run build

# Check if build was successful
if [ ! -f "$BUILD_DIR/index.html" ]; then
    echo -e "${RED}❌ Build failed. index.html not found in build output.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build completed successfully${NC}"

# Step 3: Ensure web.config is in build output
echo -e "${YELLOW}📄 Copying web.config to build output...${NC}"
if [ -f "$FRONTEND_DIR/public/web.config" ]; then
    cp "$FRONTEND_DIR/public/web.config" "$BUILD_DIR/"
    echo -e "${GREEN}✅ web.config copied${NC}"
else
    echo -e "${YELLOW}⚠️  web.config not found in public folder${NC}"
fi

# Step 4: Create ZIP package
echo -e "${YELLOW}📦 Creating deployment package...${NC}"
cd "$BUILD_DIR"
if [ -f "$DEPLOY_ZIP" ]; then
    rm "$DEPLOY_ZIP"
fi
zip -r "$DEPLOY_ZIP" . -q

echo -e "${GREEN}✅ Deployment package created: $DEPLOY_ZIP${NC}"
echo -e "${YELLOW}📊 Package size: $(du -h "$DEPLOY_ZIP" | cut -f1)${NC}"

# Step 5: Deploy to Azure
echo -e "${YELLOW}🚀 Deploying to Azure App Service...${NC}"
cd "$PROJECT_ROOT"
az webapp deploy \
    --resource-group "$RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --src-path "$DEPLOY_ZIP" \
    --type zip

echo -e "${GREEN}✅ Deployment completed!${NC}"
echo ""
echo -e "${GREEN}🌐 Your app should be available at: https://$AZURE_WEBAPP_NAME.azurewebsites.net${NC}"
echo ""
echo -e "${YELLOW}📝 Note: It may take a few minutes for the changes to propagate.${NC}"


