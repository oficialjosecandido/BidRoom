#!/bin/bash

# Bidroom Azure Deployment Script - Production Environment
set -e

# Configuration
ENVIRONMENT="prod"
LOCATION="East US"
RESOURCE_GROUP="rg-bidroom-prod"
SUBSCRIPTION_ID="your-subscription-id"

echo "🚀 Deploying Bidroom Production Environment..."

# Confirm production deployment
echo "⚠️  You are about to deploy to PRODUCTION!"
read -p "Are you sure you want to continue? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "❌ Production deployment cancelled."
    exit 1
fi

# Login to Azure (if not already logged in)
echo "📋 Checking Azure login status..."
az account show > /dev/null 2>&1 || {
    echo "🔐 Please login to Azure..."
    az login
}

# Set subscription
echo "🎯 Setting Azure subscription..."
az account set --subscription $SUBSCRIPTION_ID

# Create resource group
echo "📦 Creating resource group..."
az group create \
    --name $RESOURCE_GROUP \
    --location "$LOCATION" \
    --tags Environment=$ENVIRONMENT Project=Bidroom

# Deploy infrastructure
echo "🏗️ Deploying Azure infrastructure..."
az deployment group create \
    --resource-group $RESOURCE_GROUP \
    --template-file bicep/main.bicep \
    --parameters environment=$ENVIRONMENT location="$LOCATION" \
    --name "bidroom-prod-deployment-$(date +%Y%m%d-%H%M%S)" \
    --verbose

# Get deployment outputs
echo "📊 Getting deployment outputs..."
FRONTEND_URL=$(az deployment group show \
    --resource-group $RESOURCE_GROUP \
    --name "bidroom-prod-deployment-$(date +%Y%m%d-%H%M%S)" \
    --query properties.outputs.frontendUrl.value -o tsv)

BACKEND_URL=$(az deployment group show \
    --resource-group $RESOURCE_GROUP \
    --name "bidroom-prod-deployment-$(date +%Y%m%d-%H%M%S)" \
    --query properties.outputs.backendUrl.value -o tsv)

KEY_VAULT_NAME=$(az deployment group show \
    --resource-group $RESOURCE_GROUP \
    --name "bidroom-prod-deployment-$(date +%Y%m%d-%H%M%S)" \
    --query properties.outputs.keyVaultName.value -o tsv)

echo "✅ Production environment deployed successfully!"
echo "🌐 Frontend URL: $FRONTEND_URL"
echo "🔧 Backend URL: $BACKEND_URL"
echo "🔐 Key Vault: $KEY_VAULT_NAME"

echo ""
echo "📋 Next steps:"
echo "1. Configure secrets in Key Vault: $KEY_VAULT_NAME"
echo "2. Set up custom domain: www.bidroom.co"
echo "3. Configure SSL certificates"
echo "4. Set up CDN for static assets"
echo "5. Configure monitoring and alerting"
echo "6. Deploy your application code"
echo "7. Run smoke tests"
