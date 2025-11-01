#!/bin/bash

# Deploy Frontend to Azure Static Web App
# This script builds the frontend and provides deployment instructions
# Usage: ./scripts/deploy-frontend-azure.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_URL="https://bidroom-backend-dev.azurewebsites.net"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

echo "🚀 Building Frontend for Azure Deployment..."

# Step 1: Clean and install dependencies
echo ""
echo "📦 Installing dependencies..."
cd "$FRONTEND_DIR"

# Remove node_modules for clean install
if [ -d "node_modules" ]; then
    echo "🧹 Cleaning existing node_modules..."
    rm -rf node_modules
fi

npm install
print_status "Dependencies installed"

# Step 2: Build frontend
echo ""
echo "🔨 Building frontend with production configuration..."

# Create environment configuration for production build
print_info "Setting API URL to: $BACKEND_URL"

# Build with production configuration
npm run build

# Check if build was successful
BUILD_DIR="$FRONTEND_DIR/dist/frontend/browser"
if [ ! -f "$BUILD_DIR/index.html" ]; then
    print_error "Build failed. index.html not found in build output."
    exit 1
fi

print_status "Build completed successfully"

# Step 3: Display deployment information
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📋 Frontend Build Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Build output: $BUILD_DIR"
echo "Build size: $(du -sh "$BUILD_DIR" | cut -f1)"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "🚀 Deployment Options:"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Option 1: Automatic Deployment via GitHub"
echo "   - Push your code to the main branch"
echo "   - Azure Static Web App will automatically build and deploy"
echo "   - Make sure your Static Web App is connected to your GitHub repo"
echo ""
echo "Option 2: Manual Deployment via Azure CLI"
echo "   Run the following command:"
echo ""
echo "   cd $BUILD_DIR"
echo "   zip -r ../frontend-deploy.zip ."
echo "   az staticwebapp deploy \\"
echo "     --name bidroom-frontend-dev \\"
echo "     --resource-group bidroom-dev-rg \\"
echo "     --artifact-location dist/frontend/browser"
echo ""
echo "Option 3: Using SWA CLI (Static Web Apps CLI)"
echo "   npm install -g @azure/static-web-apps-cli"
echo "   swa deploy $BUILD_DIR \\"
echo "     --env production \\"
echo "     --deployment-token <your-deployment-token>"
echo ""
echo "═══════════════════════════════════════════════════════════════"
print_warning "Important: Make sure the API URL is configured correctly!"
echo ""
echo "   Update the API URL in your services:"
echo "   - bids.service.ts"
echo "   - listings.service.ts"
echo "   - socket.service.ts"
echo ""
echo "   Current backend URL: $BACKEND_URL"
echo ""

