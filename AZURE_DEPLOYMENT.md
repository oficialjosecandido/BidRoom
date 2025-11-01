# Azure Deployment Guide for BidRoom

This guide will help you deploy BidRoom to Azure with a Node.js App Service for the backend and a Static Web App for the frontend.

## Prerequisites

1. **Azure Account**: Sign up at [portal.azure.com](https://portal.azure.com)
2. **Azure CLI**: Install from [here](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
3. **GitHub Account**: For Static Web App deployments (recommended)
4. **MongoDB Atlas**: Or your MongoDB connection string
5. **Firebase Project**: For authentication

## Quick Start

### Step 1: Login to Azure

```bash
az login
```

### Step 2: Create Azure Resources

Run the setup script to create all required Azure resources:

```bash
./scripts/setup-azure-dev.sh
```

This script will create:
- ✅ Resource Group: `bidroom-dev-rg`
- ✅ App Service Plan: `bidroom-dev-plan`
- ✅ App Service (Backend): `bidroom-backend-dev`
- ✅ Static Web App (Frontend): `bidroom-frontend-dev`
- ✅ Azure Cache for Redis: `bidroom-dev-redis`

**Note**: Redis Cache creation takes 15-20 minutes. The script will wait for it to complete.

### Step 3: Configure Environment Variables

Configure all required environment variables for the backend:

```bash
./scripts/configure-azure-env.sh
```

This will prompt you for:
- MongoDB connection string
- JWT Secret (or generate one automatically)

The script will automatically configure:
- Redis connection details
- Frontend URL
- All other required settings

### Step 4: Deploy Backend

Deploy the backend to Azure App Service:

```bash
./scripts/deploy-backend-azure.sh
```

### Step 5: Deploy Frontend

Build and deploy the frontend:

```bash
./scripts/deploy-frontend-azure.sh
```

The frontend will either:
- Auto-deploy via GitHub (if Static Web App is connected to your repo)
- Or provide manual deployment instructions

## Manual Configuration

### Backend Environment Variables

If you prefer to configure manually via Azure Portal:

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **App Services** → **bidroom-backend-dev** → **Configuration**
3. Click **"Application settings"** → **"New application setting"**
4. Add the following settings:

```
NODE_ENV = development
PORT = 3000
MONGO_URI = <your-mongodb-connection-string>
JWT_SECRET = <your-jwt-secret>
FRONTEND_URL = https://bidroom-frontend-dev.azurestaticapps.net
REDIS_HOST = <redis-hostname>
REDIS_PORT = 6380
REDIS_PASSWORD = <redis-primary-key>
```

5. Click **"Save"** and **"Restart"** the app

### Get Redis Connection Details

```bash
az redis show --name bidroom-dev-redis --resource-group bidroom-dev-rg --query hostName -o tsv
az redis show --name bidroom-dev-redis --resource-group bidroom-dev-rg --query sslPort -o tsv
az redis list-keys --name bidroom-dev-redis --resource-group bidroom-dev-rg --query primaryKey -o tsv
```

### Frontend Configuration

For Azure Static Web Apps, you can set environment variables in the portal:

1. Go to **Static Web Apps** → **bidroom-frontend-dev** → **Configuration**
2. Add application settings:
   - `API_URL` = `https://bidroom-backend-dev.azurewebsites.net/api`

Or configure via `staticwebapp.config.json` (already included in the project).

## Deployment Methods

### Backend Deployment

#### Option A: Azure CLI (Recommended for initial setup)

```bash
cd backend
zip -r ../backend-deploy.zip .
cd ..
az webapp deploy \
  --resource-group bidroom-dev-rg \
  --name bidroom-backend-dev \
  --src-path backend-deploy.zip \
  --type zip
```

#### Option B: GitHub Actions

Create `.github/workflows/azure-backend.yml`:

```yaml
name: Deploy Backend to Azure

on:
  push:
    branches: [ main ]
    paths:
      - 'backend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: azure/webapps-deploy@v2
        with:
          app-name: 'bidroom-backend-dev'
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: './backend'
```

### Frontend Deployment

#### Option A: Automatic via GitHub (Recommended)

Azure Static Web App will automatically deploy when you push to the connected branch.

1. Connect your GitHub repository in Azure Portal
2. Push to the `main` branch
3. Deployment will trigger automatically

#### Option B: Azure CLI

```bash
npm install -g @azure/static-web-apps-cli
cd frontend
npm run build
swa deploy dist/frontend/browser \
  --env production \
  --deployment-token <your-token>
```

## Testing Your Deployment

### Backend Health Check

```bash
curl https://bidroom-backend-dev.azurewebsites.net/health
```

Expected response:
```json
{
  "status": "OK",
  "uptime": 123.45,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Frontend

Visit: `https://bidroom-frontend-dev.azurestaticapps.net`

## Troubleshooting

### Backend Issues

1. **Check Logs**:
   ```bash
   az webapp log tail --name bidroom-backend-dev --resource-group bidroom-dev-rg
   ```

2. **View Logs in Portal**:
   - Azure Portal → App Services → bidroom-backend-dev → Log stream

3. **Common Issues**:
   - **401 Unauthorized**: Check that environment variables are set correctly
   - **Connection Error**: Verify MongoDB URI and Redis connection
   - **Socket.io Not Working**: Ensure Web Sockets are enabled in App Service settings

### Frontend Issues

1. **Check Build Logs**:
   - Azure Portal → Static Web Apps → bidroom-frontend-dev → Deployment history

2. **API Connection Issues**:
   - Verify `API_URL` is set correctly
   - Check browser console for CORS errors
   - Ensure backend `FRONTEND_URL` includes the correct frontend domain

### Redis Connection Issues

1. **Test Redis Connection**:
   ```bash
   az redis show --name bidroom-dev-redis --resource-group bidroom-dev-rg
   ```

2. **Check Connection String**:
   - Host: `<cache-name>.redis.cache.windows.net`
   - Port: 6380 (SSL)
   - Password: Primary key from Azure Portal

## Costs

### Estimated Monthly Costs (Development Environment)

- **App Service Plan (B1)**: ~$13/month
- **Static Web App**: Free tier available
- **Azure Cache for Redis (Basic C0)**: ~$16/month
- **Total**: ~$29/month

**Note**: You can reduce costs by:
- Using App Service Plan Free tier (with limitations)
- Using Redis Cache only when needed
- Shutting down resources when not in use

## Next Steps

1. ✅ Set up production environment (separate resource group)
2. ✅ Configure custom domain
3. ✅ Set up SSL certificates
4. ✅ Configure CDN for static assets
5. ✅ Set up monitoring and alerts
6. ✅ Configure backup policies

## Useful Commands

```bash
# View all resources
az resource list --resource-group bidroom-dev-rg --output table

# Get backend URL
az webapp show --name bidroom-backend-dev --resource-group bidroom-dev-rg --query defaultHostname -o tsv

# Get frontend URL
az staticwebapp show --name bidroom-frontend-dev --resource-group bidroom-dev-rg --query defaultHostname -o tsv

# Restart backend
az webapp restart --name bidroom-backend-dev --resource-group bidroom-dev-rg

# View backend logs
az webapp log tail --name bidroom-backend-dev --resource-group bidroom-dev-rg

# Delete all resources (be careful!)
az group delete --name bidroom-dev-rg --yes --no-wait
```

## Support

For issues or questions:
1. Check Azure Portal logs
2. Review deployment scripts for errors
3. Check Azure Service Health
4. Review this documentation

---

**Last Updated**: 2024-01-01
**Azure Region**: East US

