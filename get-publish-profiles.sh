#!/bin/bash

echo "🔍 Getting publish profiles for Azure App Services..."

echo ""
echo "📋 Backend App Service (bidroom-backend-dev):"
echo "1. Go to Azure Portal: https://portal.azure.com"
echo "2. Navigate to: App Services → bidroom-backend-dev"
echo "3. Click on 'Get publish profile' button"
echo "4. Copy the entire content of the downloaded .PublishSettings file"
echo "5. Paste it as the value for AZURE_WEBAPP_PUBLISH_PROFILE secret in GitHub"

echo ""
echo "📋 Frontend App Service (bidroom-frontend-dev):"
echo "1. Go to Azure Portal: https://portal.azure.com"
echo "2. Navigate to: App Services → bidroom-frontend-dev"
echo "3. Click on 'Get publish profile' button"
echo "4. Copy the entire content of the downloaded .PublishSettings file"
echo "5. Paste it as the value for AZURE_FRONTEND_PUBLISH_PROFILE secret in GitHub"

echo ""
echo "🔗 GitHub Secrets URL:"
echo "https://github.com/oficialjosecandido/BidRoom/settings/secrets/actions"

echo ""
echo "⚠️  Important:"
echo "- Make sure to copy the ENTIRE content of the .PublishSettings file"
echo "- Don't modify or edit the content"
echo "- The file should start with '<publishData>' and end with '</publishData>'"
