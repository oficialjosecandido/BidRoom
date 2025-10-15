#!/bin/bash

# Bidroom Azure Deployment Script
# This script deploys the infrastructure and application to Azure

set -e

# Configuration
RESOURCE_GROUP="bidroom-rg"
LOCATION="eastus"
ENVIRONMENT="dev"
APP_NAME="bidroom"

echo "🚀 Starting Bidroom Azure Deployment"
echo "======================================"
echo "Environment: $ENVIRONMENT"
echo "Location: $LOCATION"
echo ""

# Login to Azure (if not already logged in)
echo "📝 Checking Azure login..."
az account show > /dev/null 2>&1 || az login

# Create resource group if it doesn't exist
echo "📦 Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION

# Deploy infrastructure using Bicep
echo "🏗️  Deploying Azure infrastructure..."
DEPLOYMENT_OUTPUT=$(az deployment group create \
  --resource-group $RESOURCE_GROUP \
  --template-file infrastructure/azure/bicep/main.bicep \
  --parameters environmentName=$ENVIRONMENT appName=$APP_NAME \
  --query 'properties.outputs' \
  --output json)

# Extract outputs
ACR_LOGIN_SERVER=$(echo $DEPLOYMENT_OUTPUT | jq -r '.acrLoginServer.value')
AKS_CLUSTER_NAME=$(echo $DEPLOYMENT_OUTPUT | jq -r '.aksClusterName.value')
REDIS_HOST=$(echo $DEPLOYMENT_OUTPUT | jq -r '.redisCacheHostName.value')
STORAGE_ACCOUNT=$(echo $DEPLOYMENT_OUTPUT | jq -r '.storageAccountName.value')
APP_INSIGHTS_KEY=$(echo $DEPLOYMENT_OUTPUT | jq -r '.appInsightsInstrumentationKey.value')

echo "✅ Infrastructure deployed successfully!"
echo "ACR: $ACR_LOGIN_SERVER"
echo "AKS: $AKS_CLUSTER_NAME"
echo ""

# Login to ACR
echo "🔐 Logging in to Azure Container Registry..."
az acr login --name ${ACR_LOGIN_SERVER%%.*}

# Build and push Docker images
echo "🐳 Building and pushing Docker images..."

# Backend
echo "Building backend..."
docker build -t $ACR_LOGIN_SERVER/bidroom-backend:latest ./backend
docker push $ACR_LOGIN_SERVER/bidroom-backend:latest

# Frontend
echo "Building frontend..."
docker build -t $ACR_LOGIN_SERVER/bidroom-frontend:latest ./frontend
docker push $ACR_LOGIN_SERVER/bidroom-frontend:latest

echo "✅ Docker images pushed successfully!"
echo ""

# Get AKS credentials
echo "🔑 Getting AKS credentials..."
az aks get-credentials --resource-group $RESOURCE_GROUP --name $AKS_CLUSTER_NAME --overwrite-existing

# Update Kubernetes manifests with ACR name
echo "📝 Updating Kubernetes manifests..."
sed -i "s|<YOUR_ACR_NAME>|${ACR_LOGIN_SERVER%%.*}|g" infrastructure/kubernetes/*.yaml

# Apply Kubernetes configurations
echo "☸️  Deploying to Kubernetes..."

# Create secrets (Note: You should update secrets.example.yaml with actual values first)
echo "Creating Kubernetes secrets..."
kubectl apply -f infrastructure/kubernetes/secrets.yaml

# Deploy backend
echo "Deploying backend..."
kubectl apply -f infrastructure/kubernetes/backend-deployment.yaml

# Deploy frontend
echo "Deploying frontend..."
kubectl apply -f infrastructure/kubernetes/frontend-deployment.yaml

# Deploy ingress
echo "Deploying ingress..."
kubectl apply -f infrastructure/kubernetes/ingress.yaml

# Deploy HPA
echo "Deploying horizontal pod autoscaler..."
kubectl apply -f infrastructure/kubernetes/hpa.yaml

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "📊 Resource Information:"
echo "========================"
echo "Resource Group: $RESOURCE_GROUP"
echo "ACR: $ACR_LOGIN_SERVER"
echo "AKS: $AKS_CLUSTER_NAME"
echo "Redis: $REDIS_HOST"
echo "Storage: $STORAGE_ACCOUNT"
echo ""
echo "🔍 Check deployment status:"
echo "kubectl get pods"
echo "kubectl get services"
echo "kubectl get ingress"
echo ""
echo "📝 View logs:"
echo "kubectl logs -l app=bidroom-backend --tail=100"
echo "kubectl logs -l app=bidroom-frontend --tail=100"

