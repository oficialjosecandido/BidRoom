# Bidroom Deployment Guide

This guide covers deploying the Bidroom platform to Azure Kubernetes Service (AKS).

## Prerequisites

- Azure subscription
- Azure CLI installed and configured
- kubectl installed
- Docker installed
- MongoDB Atlas account (or Azure Cosmos DB for MongoDB)
- Azure AD B2C tenant configured
- Stripe account

## Azure Resources

The deployment creates the following Azure resources:

- **Azure Kubernetes Service (AKS)** - Container orchestration
- **Azure Container Registry (ACR)** - Docker image storage
- **Azure Cache for Redis** - Real-time bid caching
- **Azure Blob Storage** - Image and media storage
- **Azure Application Insights** - Monitoring and logging
- **Azure Log Analytics** - Centralized logging
- **Azure Application Gateway** - Load balancing and SSL termination

## Deployment Steps

### 1. Configure Azure AD B2C

1. Create an Azure AD B2C tenant
2. Register the application
3. Create sign-up/sign-in user flow
4. Note down:
   - Tenant name
   - Client ID
   - Client Secret
   - Policy name

### 2. Set Up MongoDB

Option A: MongoDB Atlas
- Create a cluster
- Configure network access
- Create database user
- Get connection string

Option B: Azure Cosmos DB for MongoDB
- Create Cosmos DB account with MongoDB API
- Get connection string

### 3. Configure Stripe

1. Create Stripe account
2. Get API keys (secret key)
3. Set up webhook endpoint
4. Configure payment intents

### 4. Prepare Deployment

```bash
# Clone the repository
git clone <repository-url>
cd bidroom

# Set environment variables
export RESOURCE_GROUP="bidroom-rg"
export LOCATION="eastus"
export ENVIRONMENT="prod"
```

### 5. Create Kubernetes Secrets

Create `infrastructure/kubernetes/secrets.yaml` from the example:

```bash
cp infrastructure/kubernetes/secrets.example.yaml infrastructure/kubernetes/secrets.yaml
```

Edit `secrets.yaml` with your actual credentials:
- MongoDB URI
- Redis credentials (will be populated after infrastructure deployment)
- JWT secret (generate a strong random string)
- Azure AD B2C credentials
- Azure Storage connection string
- Stripe API keys

### 6. Deploy Infrastructure

Run the deployment script:

```bash
chmod +x infrastructure/azure/deploy.sh
./infrastructure/azure/deploy.sh
```

This script will:
1. Create resource group
2. Deploy Azure resources using Bicep
3. Build and push Docker images
4. Deploy to Kubernetes
5. Configure auto-scaling

### 7. Configure DNS

After deployment, get the ingress public IP:

```bash
kubectl get ingress bidroom-ingress
```

Configure your DNS:
- `www.bidroom.co` → Ingress IP
- `api.bidroom.co` → Ingress IP

### 8. Set Up SSL Certificates

The ingress is configured to use Let's Encrypt. Ensure cert-manager is installed:

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer for Let's Encrypt
kubectl apply -f infrastructure/kubernetes/cert-manager-issuer.yaml
```

### 9. Verify Deployment

```bash
# Check pods
kubectl get pods

# Check services
kubectl get services

# Check ingress
kubectl get ingress

# View logs
kubectl logs -l app=bidroom-backend --tail=100
kubectl logs -l app=bidroom-frontend --tail=100

# Check HPA
kubectl get hpa
```

### 10. Monitor Application

Access Application Insights in Azure Portal:
- Real-time metrics
- Request analytics
- Failure tracking
- Performance monitoring

## CI/CD with GitHub Actions

The repository includes a GitHub Actions workflow for automated deployment.

### Setup GitHub Secrets

Add the following secrets to your GitHub repository:

```
AZURE_CREDENTIALS
ACR_NAME
ACR_LOGIN_SERVER
```

Get Azure credentials:

```bash
az ad sp create-for-rbac \
  --name "bidroom-github-actions" \
  --role contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/bidroom-rg \
  --sdk-auth
```

### Workflow Triggers

- **Push to main**: Runs tests, builds images, and deploys to production
- **Push to develop**: Runs tests and builds images (no deployment)
- **Pull requests**: Runs tests only

## Scaling

### Manual Scaling

```bash
# Scale backend
kubectl scale deployment bidroom-backend --replicas=5

# Scale frontend
kubectl scale deployment bidroom-frontend --replicas=3
```

### Auto-scaling

HPA (Horizontal Pod Autoscaler) is configured to scale based on:
- CPU utilization (target: 70%)
- Memory utilization (target: 80%)

Backend: 3-10 replicas
Frontend: 2-8 replicas

## Updating the Application

### Using GitHub Actions (Recommended)

Push to main branch triggers automatic deployment.

### Manual Update

```bash
# Build new images
docker build -t $ACR_LOGIN_SERVER/bidroom-backend:v2 ./backend
docker push $ACR_LOGIN_SERVER/bidroom-backend:v2

# Update deployment
kubectl set image deployment/bidroom-backend backend=$ACR_LOGIN_SERVER/bidroom-backend:v2

# Check rollout status
kubectl rollout status deployment/bidroom-backend
```

### Rollback

```bash
# Rollback to previous version
kubectl rollout undo deployment/bidroom-backend

# Rollback to specific revision
kubectl rollout undo deployment/bidroom-backend --to-revision=2
```

## Monitoring and Debugging

### View Logs

```bash
# Real-time logs
kubectl logs -f deployment/bidroom-backend

# Logs from specific pod
kubectl logs <pod-name>

# Logs from all pods with label
kubectl logs -l app=bidroom-backend --all-containers=true
```

### Execute Commands in Pod

```bash
# Get shell access
kubectl exec -it <pod-name> -- /bin/sh

# Run command
kubectl exec <pod-name> -- npm run status
```

### Check Resource Usage

```bash
# Node resources
kubectl top nodes

# Pod resources
kubectl top pods
```

## Backup and Recovery

### Database Backup

Configure MongoDB Atlas automated backups or Azure Cosmos DB backup policies.

### Application State

Redis data is cached and can be regenerated. No backup required.

### User-uploaded Media

Azure Blob Storage has built-in redundancy (LRS/GRS).

## Cost Optimization

1. **Use Azure Reserved Instances** for AKS nodes
2. **Configure auto-scaling** to scale down during low traffic
3. **Use Azure CDN** for static assets
4. **Monitor costs** with Azure Cost Management
5. **Right-size resources** based on actual usage

## Security Checklist

- ✅ All secrets stored in Kubernetes Secrets
- ✅ HTTPS only (SSL/TLS)
- ✅ Network policies configured
- ✅ RBAC enabled on AKS
- ✅ Private AKS cluster (optional, for production)
- ✅ Azure AD authentication for AKS
- ✅ Container image scanning
- ✅ Regular security updates

## Troubleshooting

### Pods Not Starting

```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

### Service Not Accessible

```bash
kubectl get services
kubectl describe service bidroom-backend-service
```

### Database Connection Issues

Check secrets and network connectivity from pods.

### High Memory/CPU Usage

Check HPA status and consider increasing resource limits.

## Support

For issues and questions:
- Create an issue in the repository
- Contact: devops@bidroom.co

