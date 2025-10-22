# 🚀 Quick Start: Deploy BidRoom to Azure

## Prerequisites
- [x] Azure account with active subscription
- [x] GitHub repository with your code
- [x] MongoDB Atlas account
- [x] Azure CLI installed (`az --version`)

## 🎯 One-Command Setup

```bash
# 1. Login to Azure
az login

# 2. Run the setup script
./scripts/setup-azure-dev.sh
```

## 📋 Manual Setup (Alternative)

### 1. Create Azure Resources

```bash
# Create resource group
az group create --name bidroom-dev-rg --location "East US"

# Create App Service Plan
az appservice plan create --name bidroom-dev-plan --resource-group bidroom-dev-rg --sku B1 --is-linux

# Create Web App (Backend)
az webapp create --resource-group bidroom-dev-rg --plan bidroom-dev-plan --name bidroom-backend-dev --runtime "NODE|18-lts"

# Create Static Web App (Frontend)
az staticwebapp create --name bidroom-frontend-dev --resource-group bidroom-dev-rg --source https://github.com/yourusername/bidroom --location "East US 2" --branch dev --app-location "/frontend" --output-location "dist/frontend"
```

### 2. Configure GitHub Secrets

Go to GitHub → Settings → Secrets and variables → Actions

Add these secrets:
- `AZURE_WEBAPP_PUBLISH_PROFILE` - From Azure Portal → App Service → Get publish profile
- `AZURE_STATIC_WEB_APPS_API_TOKEN` - From Azure Portal → Static Web App → Manage deployment token

### 3. Set Environment Variables

In Azure Portal → App Services → bidroom-backend-dev → Configuration:

```
NODE_ENV=development
MONGO_URI=mongodb+srv://josevcandido_db_user:<password>@clusterbr.pw2gswl.mongodb.net/bidroom_dev
JWT_SECRET=your-super-secret-jwt-key-for-development
FRONTEND_URL=https://bidroom-frontend-dev.azurestaticapps.net
```

### 4. Deploy

```bash
git add .
git commit -m "Add Azure deployment configuration"
git push origin dev
```

## 🔍 Verify Deployment

- **Backend**: `https://bidroom-backend-dev.azurewebsites.net/api/auth/register`
- **Frontend**: `https://bidroom-frontend-dev.azurestaticapps.net`
- **GitHub Actions**: Check the Actions tab for deployment status

## 🆘 Troubleshooting

### Common Issues

1. **Build Fails**: Check Node.js version and dependencies
2. **Environment Variables**: Verify all required variables are set
3. **Database Connection**: Check MongoDB Atlas IP whitelist
4. **CORS Issues**: Update CORS settings in backend

### Useful Commands

```bash
# Check Azure resources
az resource list --resource-group bidroom-dev-rg

# View app logs
az webapp log tail --name bidroom-backend-dev --resource-group bidroom-dev-rg

# Restart app
az webapp restart --name bidroom-backend-dev --resource-group bidroom-dev-rg
```

## 📊 Monitoring

- **Azure Portal**: Monitor resource usage and logs
- **GitHub Actions**: Track deployment status
- **MongoDB Atlas**: Monitor database performance

---

**Need Help?** Check the full [Azure Deployment Guide](./AZURE_DEPLOYMENT_GUIDE.md) for detailed instructions.
