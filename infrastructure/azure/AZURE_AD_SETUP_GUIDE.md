# 🔐 Azure AD Setup Guide for Bidroom

This guide walks you through setting up Azure Active Directory (Regular) for the Bidroom application.

## 📋 Prerequisites

- Azure subscription
- Azure CLI installed
- Domain name (optional, for custom domains)

## 🚀 Step-by-Step Setup

### **Step 1: Create Azure AD Application Registration**

1. **Go to Azure Portal**: https://portal.azure.com
2. **Search for "Azure Active Directory"**
3. **Click on your tenant** (or create one if needed)
4. **Go to "App registrations"**
5. **Click "New registration"**

### **Step 2: Configure Application Registration**

**Fill in the details**:
- **Name**: `Bidroom Frontend`
- **Supported account types**: 
  - Choose `Accounts in this organizational directory only` (for single tenant)
  - Or `Accounts in any organizational directory` (for multi-tenant)
- **Redirect URI**: 
  - Platform: `Single-page application (SPA)`
  - URI: `http://localhost:4201/auth/callback`

**Click "Register"**

### **Step 3: Note Down Important Values**

After registration, you'll see the **Overview** page. Note down:

- **Application (client) ID**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Directory (tenant) ID**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

### **Step 4: Configure Authentication**

1. **Go to "Authentication"** in the left menu
2. **Add Redirect URIs**:
   - DEV: `http://localhost:4201/auth/callback`
   - QA: `https://qa.bidroom.co/auth/callback`
   - PROD: `https://www.bidroom.co/auth/callback`
3. **Add Logout URLs**:
   - DEV: `http://localhost:4201`
   - QA: `https://qa.bidroom.co`
   - PROD: `https://www.bidroom.co`
4. **Enable**:
   - ✅ ID tokens
   - ✅ Access tokens
5. **Click "Save"**

### **Step 5: Create Client Secret (for Backend)**

1. **Go to "Certificates & secrets"**
2. **Click "New client secret"**
3. **Description**: `Bidroom Backend Secret`
4. **Expires**: `24 months` (or your preference)
5. **Click "Add"**
6. **Copy the secret value** (you won't see it again!)

### **Step 6: Configure API Permissions**

1. **Go to "API permissions"**
2. **Click "Add a permission"**
3. **Select "Microsoft Graph"**
4. **Choose "Delegated permissions"**
5. **Add these permissions**:
   - `openid` ✅
   - `profile` ✅
   - `email` ✅
   - `User.Read` ✅
6. **Click "Add permissions"**
7. **Click "Grant admin consent"** (if you're an admin)

### **Step 7: Enable Optional Features**

1. **Go to "Branding & properties"**
2. **Configure**:
   - Logo (optional)
   - Home page URL: `https://www.bidroom.co`
   - Privacy statement URL: `https://www.bidroom.co/privacy`
   - Terms of service URL: `https://www.bidroom.co/terms`

## 🔧 Configuration Files Update

### **Frontend Configuration**

Update your environment files with the values from Step 3:

**`frontend/src/environments/environment.ts`**:
```typescript
azureAdB2C: {
  clientId: 'YOUR_APPLICATION_CLIENT_ID', // From Step 3
  tenantId: 'YOUR_DIRECTORY_TENANT_ID',   // From Step 3
  authority: 'https://login.microsoftonline.com/YOUR_DIRECTORY_TENANT_ID',
  redirectUri: 'http://localhost:4201/auth/callback',
  postLogoutRedirectUri: 'http://localhost:4201',
  knownAuthorities: ['login.microsoftonline.com'],
},
```

**`frontend/src/environments/environment.prod.ts`**:
```typescript
azureAdB2C: {
  clientId: 'YOUR_APPLICATION_CLIENT_ID',
  tenantId: 'YOUR_DIRECTORY_TENANT_ID',
  authority: 'https://login.microsoftonline.com/YOUR_DIRECTORY_TENANT_ID',
  redirectUri: 'https://www.bidroom.co/auth/callback',
  postLogoutRedirectUri: 'https://www.bidroom.co',
  knownAuthorities: ['login.microsoftonline.com'],
},
```

### **Backend Configuration**

Create a `.env` file in your backend directory:

**`backend/.env`**:
```bash
# Azure AD Configuration
AZURE_AD_TENANT_ID=YOUR_DIRECTORY_TENANT_ID
AZURE_AD_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID
AZURE_AD_CLIENT_SECRET=YOUR_CLIENT_SECRET_VALUE

# Other configurations...
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/bidroom
JWT_SECRET=your-jwt-secret-here
STRIPE_SECRET_KEY=sk_test_your_stripe_key
```

## 🧪 Testing the Setup

### **1. Test Frontend Authentication**

```bash
cd frontend
npm start
```

Navigate to `http://localhost:4201` and try to log in.

### **2. Test Backend API**

```bash
cd backend
npm run dev
```

Test the health endpoint: `http://localhost:3001/health`

### **3. Test Full Authentication Flow**

1. **Login** through the frontend
2. **Check browser console** for any errors
3. **Verify token** in browser developer tools
4. **Test API calls** that require authentication

## 🚀 Production Deployment

### **1. Update Production URLs**

Make sure your production environment files have the correct URLs:

- **Frontend**: `https://www.bidroom.co/auth/callback`
- **Backend**: `https://api.bidroom.co`

### **2. Configure Custom Domain**

If you have a custom domain:

1. **Add custom domain** in Azure AD
2. **Update redirect URIs** to use your domain
3. **Configure DNS** records

### **3. Security Best Practices**

- ✅ **Use HTTPS** everywhere
- ✅ **Enable MFA** for admin accounts
- ✅ **Regular security reviews**
- ✅ **Monitor sign-in logs**
- ✅ **Use conditional access** (if available in your plan)

## 🔍 Troubleshooting

### **Common Issues**

1. **"AADSTS50011: The reply URL specified in the request does not match"**
   - **Solution**: Check redirect URIs in Azure AD app registration

2. **"AADSTS65001: The user or administrator has not consented"**
   - **Solution**: Grant admin consent for API permissions

3. **"AADSTS70011: The provided value for the 'scope' parameter is not valid"**
   - **Solution**: Check scopes in your MSAL configuration

### **Debug Commands**

```bash
# Check Azure CLI login status
az account show

# List app registrations
az ad app list --display-name "Bidroom Frontend"

# Get app registration details
az ad app show --id YOUR_APPLICATION_CLIENT_ID
```

## 📊 Monitoring

### **Azure AD Sign-in Logs**

1. **Go to Azure Portal**
2. **Azure Active Directory** → **Monitoring** → **Sign-in logs**
3. **Monitor** authentication attempts and failures

### **Application Insights**

The application is configured to send authentication events to Application Insights for monitoring.

## 🔄 Next Steps

1. **Test the authentication flow** thoroughly
2. **Configure user roles** if needed
3. **Set up conditional access** policies
4. **Configure monitoring** and alerting
5. **Plan for scaling** (consider Azure AD Premium features)

## 📞 Support

- **Azure AD Documentation**: https://docs.microsoft.com/azure/active-directory/
- **MSAL.js Documentation**: https://docs.microsoft.com/azure/active-directory/develop/msal-js-initializing-client-applications
- **Azure Support**: Available through Azure Portal

## 🎯 Summary

You now have:
- ✅ Azure AD application registration
- ✅ Frontend configured for Azure AD
- ✅ Backend configured for Azure AD
- ✅ Authentication flow ready
- ✅ Production-ready configuration

Your Bidroom application is now ready for Azure AD authentication! 🚀
