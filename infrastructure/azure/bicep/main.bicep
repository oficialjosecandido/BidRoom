// Bidroom Azure Infrastructure - Main Template
param environment string = 'dev'
param location string = resourceGroup().location
param appServicePlanSku string = environment == 'prod' ? 'P2V2' : 'B1'

// Variables
var resourcePrefix = 'bidroom-${environment}'
var appServiceName = '${resourcePrefix}-web'
var apiServiceName = '${resourcePrefix}-api'
var storageAccountName = '${resourcePrefix}storage${uniqueString(resourceGroup().id)}'
var keyVaultName = '${resourcePrefix}-kv-${uniqueString(resourceGroup().id)}'
var applicationInsightsName = '${resourcePrefix}-ai'

// Application Insights
resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

// Log Analytics Workspace
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2021-12-01-preview' = {
  name: '${resourcePrefix}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: environment == 'prod' ? 90 : 30
  }
}

// Key Vault for secrets
resource keyVault 'Microsoft.KeyVault/vaults@2022-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      name: 'standard'
      family: 'A'
    }
    tenantId: subscription().tenantId
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: systemAssignedIdentity.principalId
        permissions: {
          secrets: ['get', 'list']
          certificates: ['get', 'list']
        }
      }
    ]
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true
  }
}

// App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: '${resourcePrefix}-plan'
  location: location
  sku: {
    name: appServicePlanSku
    tier: environment == 'prod' ? 'PremiumV2' : 'Basic'
    capacity: environment == 'prod' ? 2 : 1
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

// System Assigned Identity for App Services
resource systemAssignedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2021-09-30-preview' = {
  name: '${resourcePrefix}-identity'
  location: location
}

// Storage Account for static files and images
resource storageAccount 'Microsoft.Storage/storageAccounts@2022-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// Blob Container for images
resource blobContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2022-05-01' = {
  parent: storageAccount::storageAccount::default
  name: 'images'
  properties: {
    publicAccess: 'None'
  }
}

// Frontend App Service (Angular)
resource frontendApp 'Microsoft.Web/sites@2022-03-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|18-lts'
      appSettings: [
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '18-lts'
        }
        {
          name: 'API_URL'
          value: 'https://${apiServiceName}.azurewebsites.net/api/v1'
        }
        {
          name: 'SOCKET_URL'
          value: 'https://${apiServiceName}.azurewebsites.net'
        }
        {
          name: 'AZURE_AD_B2C_CLIENT_ID'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=azure-ad-b2c-client-id)'
        }
        {
          name: 'AZURE_AD_B2C_AUTHORITY'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=azure-ad-b2c-authority)'
        }
        {
          name: 'AZURE_AD_B2C_REDIRECT_URI'
          value: environment == 'prod' ? 'https://www.bidroom.co/auth/callback' : environment == 'qa' ? 'https://qa.bidroom.co/auth/callback' : 'http://localhost:4201/auth/callback'
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: applicationInsights.properties.InstrumentationKey
        }
      ]
      cors: {
        allowedOrigins: [
          'https://www.bidroom.co'
          'https://qa.bidroom.co'
          'http://localhost:4201'
        ]
      }
    }
    identity: {
      type: 'SystemAssigned'
    }
  }
}

// Backend App Service (Node.js)
resource backendApp 'Microsoft.Web/sites@2022-03-01' = {
  name: apiServiceName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|18-lts'
      appSettings: [
        {
          name: 'NODE_ENV'
          value: environment
        }
        {
          name: 'PORT'
          value: '8080'
        }
        {
          name: 'MONGODB_URI'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=mongodb-connection-string)'
        }
        {
          name: 'REDIS_URL'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=redis-connection-string)'
        }
        {
          name: 'JWT_SECRET'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=jwt-secret)'
        }
        {
          name: 'JWT_REFRESH_SECRET'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=jwt-refresh-secret)'
        }
        {
          name: 'AZURE_AD_B2C_CLIENT_ID'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=azure-ad-b2c-client-id)'
        }
        {
          name: 'AZURE_AD_B2C_CLIENT_SECRET'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=azure-ad-b2c-client-secret)'
        }
        {
          name: 'AZURE_AD_B2C_AUTHORITY'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=azure-ad-b2c-authority)'
        }
        {
          name: 'STRIPE_SECRET_KEY'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=stripe-secret-key)'
        }
        {
          name: 'STRIPE_WEBHOOK_SECRET'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=stripe-webhook-secret)'
        }
        {
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=azure-storage-connection-string)'
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: applicationInsights.properties.InstrumentationKey
        }
      ]
      cors: {
        allowedOrigins: [
          'https://www.bidroom.co'
          'https://qa.bidroom.co'
          'http://localhost:4201'
        ]
      }
    }
    identity: {
      type: 'SystemAssigned'
    }
  }
}

// Key Vault Access Policy for App Services
resource keyVaultAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2022-07-01' = {
  parent: keyVault
  name: '${frontendApp.properties.name}-access'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: frontendApp.identity.principalId
        permissions: {
          secrets: ['get', 'list']
        }
      }
    ]
  }
}

resource keyVaultAccessPolicyBackend 'Microsoft.KeyVault/vaults/accessPolicies@2022-07-01' = {
  parent: keyVault
  name: '${backendApp.properties.name}-access'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: backendApp.identity.principalId
        permissions: {
          secrets: ['get', 'list']
        }
      }
    ]
  }
}

// Outputs
output frontendUrl string = 'https://${frontendApp.properties.defaultHostName}'
output backendUrl string = 'https://${backendApp.properties.defaultHostName}'
output keyVaultName string = keyVaultName
output storageAccountName string = storageAccountName
output applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString