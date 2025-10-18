#!/bin/bash

# Bidroom Azure Key Vault Configuration Script
set -e

# Configuration
ENVIRONMENT=${1:-"dev"}
RESOURCE_GROUP="rg-bidroom-${ENVIRONMENT}"

echo "🔐 Configuring Key Vault secrets for $ENVIRONMENT environment..."

# Get Key Vault name
KEY_VAULT_NAME=$(az keyvault list \
    --resource-group $RESOURCE_GROUP \
    --query "[0].name" -o tsv)

if [ -z "$KEY_VAULT_NAME" ]; then
    echo "❌ Key Vault not found in resource group $RESOURCE_GROUP"
    exit 1
fi

echo "🔑 Found Key Vault: $KEY_VAULT_NAME"

# Function to set secret
set_secret() {
    local secret_name=$1
    local secret_value=$2
    local description=$3
    
    echo "📝 Setting secret: $secret_name"
    az keyvault secret set \
        --vault-name $KEY_VAULT_NAME \
        --name $secret_name \
        --value "$secret_value" \
        --description "$description" \
        --output none
}

# Prompt for secrets
echo ""
echo "🔐 Please provide the following secrets for $ENVIRONMENT environment:"
echo ""

# Azure AD B2C Configuration
read -p "Azure AD B2C Client ID: " AZURE_CLIENT_ID
read -p "Azure AD B2C Client Secret: " AZURE_CLIENT_SECRET
read -p "Azure AD B2C Authority (e.g., https://bidroom.b2clogin.com/bidroom.onmicrosoft.com/B2C_1_signupsignin): " AZURE_AUTHORITY

# Database Configuration
read -p "MongoDB Connection String: " MONGODB_URI
read -p "Redis Connection String: " REDIS_URI

# JWT Secrets
read -p "JWT Secret (generate a strong random string): " JWT_SECRET
read -p "JWT Refresh Secret (generate a different strong random string): " JWT_REFRESH_SECRET

# Stripe Configuration
read -p "Stripe Secret Key: " STRIPE_SECRET_KEY
read -s -p "Stripe Webhook Secret: " STRIPE_WEBHOOK_SECRET
echo ""

# Azure Storage
read -p "Azure Storage Connection String: " AZURE_STORAGE_CONNECTION_STRING

echo ""
echo "🚀 Setting secrets in Key Vault..."

# Set all secrets
set_secret "azure-ad-b2c-client-id" "$AZURE_CLIENT_ID" "Azure AD B2C Application Client ID"
set_secret "azure-ad-b2c-client-secret" "$AZURE_CLIENT_SECRET" "Azure AD B2C Application Client Secret"
set_secret "azure-ad-b2c-authority" "$AZURE_AUTHORITY" "Azure AD B2C Authority URL"

set_secret "mongodb-connection-string" "$MONGODB_URI" "MongoDB Atlas Connection String"
set_secret "redis-connection-string" "$REDIS_URI" "Redis Connection String"

set_secret "jwt-secret" "$JWT_SECRET" "JWT Access Token Secret"
set_secret "jwt-refresh-secret" "$JWT_REFRESH_SECRET" "JWT Refresh Token Secret"

set_secret "stripe-secret-key" "$STRIPE_SECRET_KEY" "Stripe API Secret Key"
set_secret "stripe-webhook-secret" "$STRIPE_WEBHOOK_SECRET" "Stripe Webhook Secret"

set_secret "azure-storage-connection-string" "$AZURE_STORAGE_CONNECTION_STRING" "Azure Storage Connection String"

echo ""
echo "✅ All secrets have been configured successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Verify secrets in Azure Portal: https://portal.azure.com"
echo "2. Deploy your application code"
echo "3. Test the authentication flow"
echo "4. Monitor application logs"

# List all secrets for verification
echo ""
echo "🔍 Current secrets in Key Vault:"
az keyvault secret list --vault-name $KEY_VAULT_NAME --query "[].name" -o table
