# Azure Deployment Guide for BidRoom

This guide will help you deploy your BidRoom application to Azure with automatic CI/CD from your dev branch.

## 🏗️ Architecture Overview

```
GitHub Dev Branch → GitHub Actions → Azure Services
├── Backend (Node.js) → Azure App Service
├── Frontend (Angular) → Azure Static Web Apps
└── Database → MongoDB Atlas
```

## 📋 Prerequisites

- [x] Azure account with active subscription
- [x] GitHub repository with BidRoom code
- [x] MongoDB Atlas account
- [x] Dev branch ready with latest code

## 🚀 Step-by-Step Deployment

### Step 1: Set up Azure App Service (Backend)

1. **Create App Service Plan**
   ```bash
   # Using Azure CLI
   az group create --name bidroom-dev-rg --location "East US"
   az appservice plan create --name bidroom-dev-plan --resource-group bidroom-dev-rg --sku B1 --is-linux
   ```

2. **Create Web App**
   ```bash
   az webapp create --resource-group bidroom-dev-rg --plan bidroom-dev-plan --name bidroom-backend-dev --runtime "NODE|18-lts"
   ```

3. **Configure App Settings**
   - Go to Azure Portal → App Services → bidroom-backend-dev
   - Navigate to Configuration → Application settings
   - Add the following environment variables:
     ```
     NODE_ENV=development
     MONGO_URI=mongodb+srv://josevcandido_db_user:<password>@clusterbr.pw2gswl.mongodb.net/bidroom_dev
     JWT_SECRET=your-super-secret-jwt-key-for-development
     FRONTEND_URL=https://your-static-web-app-dev.azurestaticapps.net
     ```

4. **Get Publish Profile**
   - Go to App Service → Overview → Get publish profile
   - Download the `.PublishSettings` file
   - Copy the content to GitHub Secrets as `AZURE_WEBAPP_PUBLISH_PROFILE`

### Step 2: Set up Azure Static Web Apps (Frontend)

1. **Create Static Web App**
   ```bash
   az staticwebapp create --name bidroom-frontend-dev --resource-group bidroom-dev-rg --source https://github.com/yourusername/bidroom --location "East US 2" --branch dev --app-location "/frontend" --output-location "dist/frontend"
   ```

2. **Get Deployment Token**
   - Go to Azure Portal → Static Web Apps → bidroom-frontend-dev
   - Navigate to Overview → Manage deployment token
   - Copy the token to GitHub Secrets as `AZURE_STATIC_WEB_APPS_API_TOKEN`

### Step 3: Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add the following secrets:
- `AZURE_WEBAPP_PUBLISH_PROFILE` - Content from the .PublishSettings file
- `AZURE_STATIC_WEB_APPS_API_TOKEN` - Token from Static Web App
- `MONGODB_URI` - Your MongoDB connection string
- `JWT_SECRET` - Your JWT secret key
- `FRONTEND_URL` - Your Static Web App URL

### Step 4: Set up MongoDB Atlas

1. **Create Development Database**
   - Log into MongoDB Atlas
   - Create a new cluster or use existing
   - Create a database named `bidroom_dev`
   - Create a user with read/write permissions
   - Whitelist Azure IP ranges (0.0.0.0/0 for development)

2. **Update Connection String**
   - Copy the connection string
   - Replace `<password>` with your user password
   - Update the database name to `bidroom_dev`

### Step 5: Configure Environment Variables

Create the following files in your repository:

1. **backend/.env.development** (copy from env.development.example)
2. **backend/.env.production** (copy from env.production.example)

Update the values with your actual credentials.

### Step 6: Test the Deployment

1. **Push to Dev Branch**
   ```bash
   git add .
   git commit -m "Add Azure deployment configuration"
   git push origin dev
   ```

2. **Monitor Deployment**
   - Go to GitHub → Actions tab
   - Watch the "Deploy to Azure Dev Environment" workflow
   - Check Azure Portal for successful deployments

3. **Test Endpoints**
   - Backend: `https://bidroom-backend-dev.azurewebsites.net/api/auth/register`
   - Frontend: `https://your-static-web-app-dev.azurestaticapps.net`

## 🔧 Configuration Details

### Backend Configuration

- **Runtime**: Node.js 18 LTS
- **Platform**: Linux
- **Pricing Tier**: B1 (Basic)
- **Auto-scaling**: Disabled for dev environment

### Frontend Configuration

- **Build Command**: `npm run build`
- **Output Directory**: `dist/frontend`
- **Node Version**: 18.x
- **Environment**: Development

### Database Configuration

- **Provider**: MongoDB Atlas
- **Database**: bidroom_dev
- **Connection**: Secure connection with authentication
- **Backup**: Automated daily backups

## 🚨 Troubleshooting

### Common Issues

1. **Build Failures**
   - Check Node.js version compatibility
   - Verify all dependencies are in package.json
   - Check for TypeScript compilation errors

2. **Environment Variables**
   - Ensure all required variables are set in Azure
   - Check variable names match exactly
   - Verify no typos in connection strings

3. **Database Connection**
   - Verify MongoDB Atlas IP whitelist
   - Check user permissions
   - Test connection string locally

4. **CORS Issues**
   - Update CORS settings in backend
   - Verify frontend URL in environment variables
   - Check Azure App Service CORS configuration

### Monitoring

- **Application Insights**: Enable for detailed logging
- **Azure Monitor**: Set up alerts for errors
- **GitHub Actions**: Monitor deployment status
- **MongoDB Atlas**: Monitor database performance

## 🔄 CI/CD Pipeline

The deployment pipeline automatically:
1. Triggers on push to dev branch
2. Builds backend and frontend
3. Deploys to Azure services
4. Updates environment variables
5. Runs health checks

## 📈 Next Steps

1. **Production Environment**: Set up similar configuration for production
2. **Staging Environment**: Create staging environment for testing
3. **Monitoring**: Set up comprehensive monitoring and alerting
4. **Security**: Implement additional security measures
5. **Performance**: Optimize for production workloads

## 🆘 Support

If you encounter issues:
1. Check Azure Portal logs
2. Review GitHub Actions logs
3. Verify environment variables
4. Test locally with production settings
5. Contact Azure support if needed

---

**Note**: This guide assumes you have basic familiarity with Azure services and GitHub Actions. Adjust the configuration based on your specific requirements and security policies.
