#!/bin/bash

# Bidroom Azure Deployment Script - Development Environment
set -e

# Configuration
ENVIRONMENT="dev"
LOCATION="East US"
RESOURCE_GROUP="rg-bidroom-dev"
SUBSCRIPTION_ID="your-subscription-id"

echo "🚀 Deploying Bidroom Development Environment..."

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
    --name "bidroom-dev-deployment-$(date +%Y%m%d-%H%M%S)" \
    --verbose

# Get deployment outputs
echo "📊 Getting deployment outputs..."
FRONTEND_URL=$(az deployment group show \
    --resource-group $RESOURCE_GROUP \
    --name "bidroom-dev-deployment-$(date +%Y%m%d-%H%M%S)" \
    --query properties.outputs.frontendUrl.value -o tsv)

BACKEND_URL=$(az deployment group show \
    --resource-group $RESOURCE_GROUP \
    --name "bidroom-dev-deployment-$(date +%Y%m%d-%H%M%S)" \
    --query properties.outputs.backendUrl.value -o tsv)

KEY_VAULT_NAME=$(az deployment group show \
    --resource-group $RESOURCE_GROUP \
    --name "bidroom-dev-deployment-$(date +%Y%m%d-%H%M%S)" \
    --query properties.outputs.keyVaultName.value -o tsv)

echo "✅ Development environment deployed successfully!"
echo "🌐 Frontend URL: $FRONTEND_URL"
echo "🔧 Backend URL: $BACKEND_URL"
echo "🔐 Key Vault: $KEY_VAULT_NAME"

echo ""
echo "📋 Next steps:"
echo "1. Configure secrets in Key Vault: $KEY_VAULT_NAME"
echo "2. Set up Azure AD B2C application registration"
echo "3. Deploy your application code"
echo "4. Configure custom domain (optional)"
