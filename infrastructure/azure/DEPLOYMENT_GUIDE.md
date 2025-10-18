# 🚀 Bidroom Azure Deployment Guide

This guide walks you through deploying the Bidroom application to Azure with DEV, QA, and PROD environments.

## 📋 Prerequisites

### 1. Azure CLI Installation
```bash
# Install Azure CLI
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Login to Azure
az login
```

### 2. Azure AD B2C Setup
1. **Create Azure AD B2C Tenant**
2. **Register Application**
3. **Configure User Flows**
4. **Set up Authentication**

### 3. External Services
- **MongoDB Atlas** (or Azure Cosmos DB)
- **Redis** (Azure Cache for Redis)
- **Stripe Account**
- **Domain Name** (for custom domains)

## 🏗️ Infrastructure Deployment

### Step 1: Deploy Development Environment

```bash
cd infrastructure/azure

# Make scripts executable
chmod +x deploy-dev.sh
chmod +x configure-secrets.sh

# Deploy DEV infrastructure
./deploy-dev.sh
```

### Step 2: Deploy QA Environment

```bash
# Deploy QA infrastructure
./deploy-qa.sh
```

### Step 3: Deploy Production Environment

```bash
# Deploy PROD infrastructure (with confirmation prompt)
./deploy-prod.sh
```

## 🔐 Configuration

### Azure AD B2C Setup

1. **Create Tenant**:
   - Go to [Azure Portal](https://portal.azure.com)
   - Search "Azure AD B2C"
   - Create new B2C Tenant
   - Organization: `Bidroom`
   - Domain: `bidroom.onmicrosoft.com`

2. **Register Application**:
   - Name: `Bidroom Frontend`
   - Type: `Single-page application (SPA)`
   - Redirect URIs:
     - DEV: `http://localhost:4201/auth/callback`
     - QA: `https://qa.bidroom.co/auth/callback`
     - PROD: `https://www.bidroom.co/auth/callback`

3. **Create User Flow**:
   - Type: `Sign up and sign in`
   - Name: `B2C_1_signupsignin`
   - Identity providers: Email signup/signin
   - User attributes: Email, Display Name, Given Name, Surname

### Configure Key Vault Secrets

After deploying infrastructure, configure secrets:

```bash
# Configure secrets for DEV
./configure-secrets.sh dev

# Configure secrets for QA
./configure-secrets.sh qa

# Configure secrets for PROD
./configure-secrets.sh prod
```

**Required Secrets**:
- `azure-ad-b2c-client-id`
- `azure-ad-b2c-client-secret`
- `azure-ad-b2c-authority`
- `mongodb-connection-string`
- `redis-connection-string`
- `jwt-secret`
- `jwt-refresh-secret`
- `stripe-secret-key`
- `stripe-webhook-secret`
- `azure-storage-connection-string`

## 🌐 Custom Domain Setup

### Development
- Uses Azure-provided URLs
- No custom domain needed

### QA Environment
1. **Add Custom Domain**:
   ```bash
   # Add custom domain to App Service
   az webapp config hostname add \
     --resource-group rg-bidroom-qa \
     --webapp-name bidroom-qa-web \
     --hostname qa.bidroom.co
   ```

2. **Configure DNS**:
   - Add CNAME record: `qa.bidroom.co` → `bidroom-qa-web.azurewebsites.net`

3. **SSL Certificate**:
   ```bash
   # Bind SSL certificate
   az webapp config ssl bind \
     --resource-group rg-bidroom-qa \
     --name bidroom-qa-web \
     --certificate-thumbprint [THUMBPRINT]
   ```

### Production Environment
1. **Add Custom Domain**:
   ```bash
   # Add custom domain to App Service
   az webapp config hostname add \
     --resource-group rg-bidroom-prod \
     --webapp-name bidroom-prod-web \
     --hostname www.bidroom.co
   ```

2. **Configure DNS**:
   - Add CNAME record: `www.bidroom.co` → `bidroom-prod-web.azurewebsites.net`
   - Add CNAME record: `bidroom.co` → `www.bidroom.co`

3. **SSL Certificate**:
   - Use Azure App Service Managed Certificates (free)
   - Or upload your own certificate

## 📦 Application Deployment

### Frontend (Angular) Deployment

1. **Build Application**:
   ```bash
   cd frontend
   npm run build --configuration=production
   ```

2. **Deploy to Azure**:
   ```bash
   # Deploy to DEV
   az webapp deployment source config-zip \
     --resource-group rg-bidroom-dev \
     --name bidroom-dev-web \
     --src dist/bidroom-frontend.zip

   # Deploy to QA
   az webapp deployment source config-zip \
     --resource-group rg-bidroom-qa \
     --name bidroom-qa-web \
     --src dist/bidroom-frontend.zip

   # Deploy to PROD
   az webapp deployment source config-zip \
     --resource-group rg-bidroom-prod \
     --name bidroom-prod-web \
     --src dist/bidroom-frontend.zip
   ```

### Backend (Node.js) Deployment

1. **Prepare Application**:
   ```bash
   cd backend
   npm run build
   ```

2. **Deploy to Azure**:
   ```bash
   # Deploy to DEV
   az webapp deployment source config-zip \
     --resource-group rg-bidroom-dev \
     --name bidroom-dev-api \
     --src dist.zip

   # Deploy to QA
   az webapp deployment source config-zip \
     --resource-group rg-bidroom-qa \
     --name bidroom-qa-api \
     --src dist.zip

   # Deploy to PROD
   az webapp deployment source config-zip \
     --resource-group rg-bidroom-prod \
     --name bidroom-prod-api \
     --src dist.zip
   ```

## 🔄 CI/CD Pipeline Setup

### GitHub Actions Example

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Azure

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  deploy-dev:
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      
      - name: Deploy to DEV
        run: |
          cd infrastructure/azure
          ./deploy-dev.sh

  deploy-prod:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      
      - name: Deploy to PROD
        run: |
          cd infrastructure/azure
          ./deploy-prod.sh
```

## 📊 Monitoring & Logging

### Application Insights
- Automatically configured in all environments
- Monitor performance, errors, and usage
- Set up alerts for critical issues

### Log Analytics
- Centralized logging for all environments
- Query logs using KQL
- Retention: 30 days (DEV/QA), 90 days (PROD)

### Health Checks
- Frontend: `https://[app-name].azurewebsites.net/health`
- Backend: `https://[api-name].azurewebsites.net/health`

## 🔒 Security Best Practices

### 1. Key Vault Integration
- All secrets stored in Azure Key Vault
- Managed identity for secure access
- No secrets in code or configuration files

### 2. Network Security
- HTTPS only for all environments
- CORS properly configured
- Security headers via Helmet.js

### 3. Authentication
- Azure AD B2C for identity management
- JWT tokens with proper expiration
- Refresh token rotation

### 4. Data Protection
- Encryption at rest (Azure Storage)
- Encryption in transit (HTTPS/TLS)
- Input validation and sanitization

## 🚨 Troubleshooting

### Common Issues

1. **Authentication Failures**:
   - Check Azure AD B2C configuration
   - Verify redirect URIs
   - Check Key Vault secrets

2. **Database Connection Issues**:
   - Verify MongoDB connection string
   - Check network access rules
   - Validate credentials

3. **Stripe Integration Issues**:
   - Verify API keys
   - Check webhook endpoints
   - Validate webhook signatures

### Debug Commands

```bash
# Check App Service logs
az webapp log tail --resource-group rg-bidroom-dev --name bidroom-dev-api

# Check Key Vault secrets
az keyvault secret list --vault-name [keyvault-name]

# Test connectivity
az webapp show --resource-group rg-bidroom-dev --name bidroom-dev-api
```

## 📞 Support

For deployment issues:
1. Check Azure Portal for error details
2. Review Application Insights logs
3. Check GitHub Actions logs (if using CI/CD)
4. Consult Azure documentation

## 🔄 Maintenance

### Regular Tasks
- Monitor application performance
- Update dependencies
- Review security logs
- Backup Key Vault secrets
- Update SSL certificates

### Scaling
- Monitor usage patterns
- Scale App Service plans as needed
- Consider Azure CDN for static assets
- Implement auto-scaling rules
