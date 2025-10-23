# 🚀 E2E Environment Setup Guide

Your E2E environment has been successfully created! Follow these steps to complete the setup.

---

## 📋 **What Has Been Created**

### Azure Resources:
1. **Backend App Service**: `bidroom-backend-e2e`
   - URL: https://bidroom-backend-e2e.azurewebsites.net
   - Runtime: Node.js 20 LTS
   - Startup Command: `node src/index.js`

2. **Frontend Static Web App**: `bidroom-frontend-e2e-static`
   - URL: https://icy-meadow-08af4ce0f.3.azurestaticapps.net
   - Environment: E2E
   - Build: Angular 20

### GitHub Workflows:
- `.github/workflows/deploy-e2e-backend.yml` - Backend deployment
- `.github/workflows/deploy-e2e-frontend.yml` - Frontend deployment

---

## ⚙️ **Required Setup Steps**

### 1. Set Backend Environment Variables in Azure Portal

The Azure CLI has issues setting environment variables, so you need to set them manually in the Azure Portal:

1. Go to: https://portal.azure.com
2. Navigate to: **App Services** → **bidroom-backend-e2e**
3. Go to: **Settings** → **Environment variables**
4. Add the following **Application settings**:

```
NODE_ENV        = e2e
MONGO_URI       = mongodb+srv://josevcandido_db_user:QHVmv7msE4iNbwr9@clusterbr.pw2gswl.mongodb.net/bidroom_e2e
JWT_SECRET      = [GENERATE A STRONG SECRET - use a password generator]
FRONTEND_URL    = https://icy-meadow-08af4ce0f.3.azurestaticapps.net
PORT            = 8080
EMAIL_USER      = [your email if you set up email service]
EMAIL_PASS      = [your email password if you set up email service]
```

5. Click **Apply** and **Confirm**

**⚠️ IMPORTANT**: Replace `[GENERATE A STRONG SECRET]` with a random secure string (at least 32 characters).

---

### 2. Add MongoDB Atlas IP Whitelist

Add these IPs to MongoDB Atlas Network Access:

```
20.119.0.47
20.124.159.160
20.124.159.17
20.124.159.217
20.124.159.89
20.241.208.216
20.241.209.119
20.241.209.8
20.241.211.214
20.241.211.251
20.241.211.47
20.241.211.59
20.241.212.13
20.241.212.230
20.241.212.240
20.241.213.78
20.241.214.241
20.253.80.127
20.253.80.215
20.253.80.233
20.253.80.78
20.253.80.95
20.253.81.136
20.253.81.16
20.253.81.196
20.253.81.243
20.253.81.8
20.253.81.96
20.253.82.120
20.253.82.97
20.253.83.2
```

**Steps:**
1. Go to: https://cloud.mongodb.com
2. Select your project: **ClusterBR**
3. Go to: **Network Access**
4. Click: **Add IP Address**
5. Add each IP individually or use a tool to batch add them
6. Set **Comment**: "Azure E2E Backend IPs"

---

### 3. Add GitHub Repository Secrets

You need to add this secret at the repository level:

**AZURE_STATIC_WEB_APPS_API_TOKEN_E2E**
- Value: `446d03464cef66e37e1ccc312d9ca889683146057aac9d24f79f754f273ba2b703-557c33f6-d460-4b32-92c9-c3f3c352e70600f051008af4ce0f`

**Steps to add the secret:**
1. Go to: https://github.com/oficialjosecandido/BidRoom/settings/secrets/actions
2. Click: **New repository secret**
3. Name: `AZURE_STATIC_WEB_APPS_API_TOKEN_E2E`
4. Value: `446d03464cef66e37e1ccc312d9ca889683146057aac9d24f79f754f273ba2b703-557c33f6-d460-4b32-92c9-c3f3c352e70600f051008af4ce0f`
5. Click: **Add secret**

**Note:** The workflows have been simplified to use repository-level secrets instead of environment-specific secrets.

---

## 🧪 **Testing the E2E Environment**

### Trigger Deployment:

The workflows are already configured to deploy on push to the `e2e` branch. To trigger a deployment:

```bash
# Make a small change to test deployment
git checkout e2e
echo "# E2E Environment" >> README.md
git add .
git commit -m "Test E2E deployment"
git push origin e2e
```

### Monitor Deployment:
- Backend: https://github.com/oficialjosecandido/BidRoom/actions/workflows/deploy-e2e-backend.yml
- Frontend: https://github.com/oficialjosecandido/BidRoom/actions/workflows/deploy-e2e-frontend.yml

### Verify Deployment:
1. **Backend API**: https://bidroom-backend-e2e.azurewebsites.net/api/auth/login
2. **Frontend App**: https://icy-meadow-08af4ce0f.3.azurestaticapps.net
3. **Landing Page**: https://icy-meadow-08af4ce0f.3.azurestaticapps.net/landing

---

## 🔍 **Troubleshooting**

### Backend shows "Application Error":
1. Check environment variables are set in Azure Portal
2. Check MongoDB Atlas IP whitelist
3. View backend logs: `az webapp log tail --name bidroom-backend-e2e --resource-group bidroom-dev-rg`

### Frontend shows blank page or 404:
1. Check if deployment completed successfully
2. Verify `staticwebapp.config.json` is in the build output
3. Check browser console for errors

### GitHub Actions failing:
1. Verify all secrets are set in the `e2e` environment
2. Check if `AZURE_CREDENTIALS` has permissions for the resource group

---

## 📊 **Environment Summary**

| Resource | URL | Database |
|----------|-----|----------|
| **Dev Backend** | https://bidroom-backend-dev.azurewebsites.net | `bidroom_dev` |
| **Dev Frontend** | https://witty-hill-03c48720f.3.azurestaticapps.net | - |
| **E2E Backend** | https://bidroom-backend-e2e.azurewebsites.net | `bidroom_e2e` |
| **E2E Frontend** | https://icy-meadow-08af4ce0f.3.azurestaticapps.net | - |

---

## ✅ **Setup Checklist**

- [ ] Set backend environment variables in Azure Portal
- [ ] Add E2E backend IPs to MongoDB Atlas Network Access
- [ ] Add `AZURE_STATIC_WEB_APPS_API_TOKEN_E2E` repository secret
- [ ] Test backend deployment by pushing to `e2e` branch
- [ ] Test frontend deployment by pushing to `e2e` branch
- [ ] Verify backend API is accessible
- [ ] Verify frontend app loads correctly

---

## 🎯 **Next Steps**

After completing the setup:
1. Test user registration in E2E environment
2. Test user login in E2E environment
3. Verify JWT authentication works
4. Test landing page functionality
5. Configure any E2E-specific testing tools

---

**Need Help?** Check the deployment logs or backend logs for detailed error messages.

