# Bidroom Architecture Overview

## System Architecture

Bidroom is a real-time auction platform built on a modern microservices architecture deployed on Azure.

```
┌─────────────────────────────────────────────────────────────┐
│                     Azure Cloud Platform                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐                    ┌──────────────┐       │
│  │   Azure CDN  │────────────────────│  Blob Storage│       │
│  └──────────────┘                    └──────────────┘       │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────┐                                           │
│  │  Application │                                           │
│  │   Gateway    │                                           │
│  └──────────────┘                                           │
│         │                                                     │
│         ├──────────────┬──────────────┐                     │
│         ▼              ▼              ▼                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐               │
│  │ Frontend │   │ Backend  │   │  Socket  │               │
│  │ (Angular)│   │(Node.js) │   │   .IO    │               │
│  │   Pods   │   │   Pods   │   │  Server  │               │
│  └──────────┘   └──────────┘   └──────────┘               │
│                        │              │                      │
│                        ├──────────────┤                      │
│                        ▼              ▼                      │
│  ┌─────────────────────────────────────────┐               │
│  │      Azure Kubernetes Service (AKS)     │               │
│  └─────────────────────────────────────────┘               │
│                        │                                      │
│         ┌──────────────┼──────────────┐                     │
│         ▼              ▼              ▼                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐               │
│  │ MongoDB  │   │  Redis   │   │ Azure AD │               │
│  │  Atlas   │   │  Cache   │   │   B2C    │               │
│  └──────────┘   └──────────┘   └──────────┘               │
│                                                               │
│  ┌──────────────────────────────────────────────┐          │
│  │        Application Insights & Monitoring      │          │
│  └──────────────────────────────────────────────┘          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend
- **Framework**: Angular 17
- **Language**: TypeScript
- **Styling**: SCSS
- **State Management**: RxJS
- **Real-time**: Socket.IO Client
- **Authentication**: MSAL (Microsoft Authentication Library)

### Backend
- **Runtime**: Node.js 18 LTS
- **Framework**: Express.js
- **Language**: TypeScript
- **Real-time**: Socket.IO
- **Authentication**: Passport.js with Azure AD B2C

### Databases
- **Primary Database**: MongoDB Atlas (or Azure Cosmos DB)
- **ODM**: Mongoose
- **Caching**: Azure Cache for Redis

### Infrastructure
- **Container Orchestration**: Azure Kubernetes Service (AKS)
- **Container Registry**: Azure Container Registry (ACR)
- **Load Balancer**: Azure Application Gateway
- **CDN**: Azure Content Delivery Network
- **Storage**: Azure Blob Storage
- **Monitoring**: Azure Monitor & Application Insights

## Data Flow

### 1. User Authentication Flow
```
User → Frontend → Azure AD B2C → Token → Backend → MongoDB
```

### 2. Auction Browsing Flow
```
User → Frontend → Backend API → MongoDB → Redis Cache → Frontend
```

### 3. Real-time Bidding Flow
```
User → Socket.IO Client → Socket.IO Server → 
  ├─→ Validate Bid → MongoDB
  ├─→ Update Cache → Redis
  └─→ Broadcast → All Connected Clients
```

### 4. Private Room Flow
```
Auction Ends → Check Eligibility (15+ bidders) →
  ├─→ Identify Top 5 Bidders
  ├─→ Create Private Room
  └─→ Start Overtime Bidding (1 min extension per bid)
```

## Database Schema

### Collections

#### Users
- Authentication & Profile
- Reputation & Ratings
- Payment Authorization
- Statistics & Activity

#### Auctions
- Listing Details
- Current State
- Verification Status
- Private Room Status

#### Bids
- Bid History
- Auto-bidding
- Private Room Bids

#### Transactions
- Payment Processing
- Escrow Management
- Payout Status

#### Disputes
- Dispute Management
- Evidence & Messages
- Resolution Tracking

#### Ratings
- Buyer/Seller Reviews
- Detailed Ratings

#### Watchlist
- Saved Auctions
- Notification Preferences

## Real-time Architecture

### Socket.IO Events

**Client → Server:**
- `auction:join` - Join auction room
- `auction:leave` - Leave auction room
- `bid:place` - Place a bid
- `auction:watch` - Add to watchlist
- `auction:view` - Track view count

**Server → Client:**
- `auction:state` - Current auction state
- `bid:new` - New bid placed
- `bid:success` - Bid placed successfully
- `bid:error` - Bid error
- `notification` - Real-time notifications

### Redis Caching Strategy

**Cached Data:**
- Current auction state (5 min TTL)
- User session data (30 min TTL)
- Bid history (10 min TTL)
- Active auctions list (2 min TTL)

**Cache Invalidation:**
- On new bid
- On auction status change
- On user profile update

## Security Architecture

### Authentication
- OAuth 2.0 / OpenID Connect via Azure AD B2C
- JWT tokens for API authentication
- Refresh token rotation

### Authorization
- Role-based access control
- Resource ownership validation
- Pre-authorization for bidding

### Data Protection
- All connections over HTTPS/WSS
- Encryption at rest (Azure Storage)
- Secrets in Azure Key Vault
- No passwords stored in database

### Fraud Prevention
- Credit card pre-authorization
- 30-day authorization renewal
- KYC verification levels
- IP and device tracking

## Scalability

### Horizontal Scaling
- Frontend: 2-8 pods (auto-scaling)
- Backend: 3-10 pods (auto-scaling)
- Redis: Azure Cache (managed scaling)

### Load Balancing
- Azure Application Gateway
- Kubernetes Service LoadBalancer
- WebSocket sticky sessions

### Database Scaling
- MongoDB Atlas auto-scaling
- Read replicas for queries
- Sharding for large datasets

## Monitoring & Observability

### Application Insights
- Request tracking
- Exception logging
- Performance metrics
- Custom events

### Log Analytics
- Centralized logging
- Query and analysis
- Alerts and dashboards

### Health Checks
- Liveness probes (every 10s)
- Readiness probes (every 5s)
- Startup probes

## Deployment Strategy

### CI/CD Pipeline
1. Code push to GitHub
2. Run tests (Jest, Karma)
3. Build Docker images
4. Push to Azure Container Registry
5. Update Kubernetes deployments
6. Rolling update (zero downtime)

### Rollback Strategy
- Keep previous 5 image versions
- Instant rollback via kubectl
- Automatic rollback on health check failures

## Cost Optimization

### Resource Management
- Auto-scaling based on demand
- Spot instances for non-critical workloads
- Resource limits and requests

### Caching Strategy
- CDN for static assets
- Redis for hot data
- Browser caching headers

### Storage Optimization
- Blob storage tiers (Hot/Cool)
- Image optimization
- CDN edge caching

## Disaster Recovery

### Backup Strategy
- MongoDB: Daily automated backups
- Configuration: Git repository
- Secrets: Azure Key Vault backup

### Recovery Objectives
- RTO (Recovery Time Objective): 1 hour
- RPO (Recovery Point Objective): 15 minutes

### High Availability
- Multi-zone deployment
- Database replication
- Redis persistence

