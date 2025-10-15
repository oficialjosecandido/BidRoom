# Bidroom.co - Verified Value. Decisive Win.

A real-time auction platform built on Azure with advanced features including Private Room bidding, verified listings, and comprehensive fraud prevention.

## 🚀 Technology Stack

### Frontend
- **Framework**: Angular (latest stable)
- **Language**: TypeScript
- **Styling**: SASS/SCSS
- **Authentication**: MSAL (Microsoft Authentication Library)

### Backend
- **Runtime**: Node.js (LTS)
- **Framework**: Express.js
- **Real-Time**: Socket.io
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Passport.js with Azure AD B2C

### Azure Infrastructure
- **Compute**: Azure Kubernetes Service (AKS) or Azure App Service
- **Caching**: Azure Cache for Redis
- **Storage**: Azure Blob Storage
- **CDN**: Azure Content Delivery Network
- **Identity**: Azure Active Directory B2C
- **Monitoring**: Azure Monitor & Application Insights
- **CI/CD**: Azure DevOps / GitHub Actions

## 📁 Project Structure

```
bidroom/
├── frontend/           # Angular application
├── backend/            # Node.js/Express API
├── docs/              # Documentation
└── infrastructure/    # Azure deployment configurations
```

## 🛠️ Getting Started

### Prerequisites
- Node.js (LTS version 18.x or higher)
- npm or yarn
- MongoDB (local or Atlas account)
- Azure subscription (for deployment)
- Angular CLI: `npm install -g @angular/cli`

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd bidroom
   ```

2. **Install Frontend Dependencies**
   ```bash
   cd frontend
   npm install
   ```

3. **Install Backend Dependencies**
   ```bash
   cd ../backend
   npm install
   ```

4. **Configure Environment Variables**
   - Copy `.env.example` to `.env` in the backend directory
   - Update with your Azure AD B2C, MongoDB, and Redis credentials

5. **Run Development Servers**

   Terminal 1 (Backend):
   ```bash
   cd backend
   npm run dev
   ```

   Terminal 2 (Frontend):
   ```bash
   cd frontend
   npm start
   ```

6. **Access the Application**
   - Frontend: http://localhost:4200
   - Backend API: http://localhost:3000

## 🎯 Key Features

### Public Features (Unauthenticated)
- Browse live auctions with sorting and filtering
- View verified listings with badges
- "Ending Soon" urgency sections
- Statistics dashboard for social proof

### Auction Mechanics
- **Fixed Duration Slots**: 2 hours, 24 hours, 3 days, or 7 days
- **Private Room**: Top 5 bidders compete after 15+ participants
- **Soft Closing**: Extends by 1 minute with each new bid
- **Buy Now**: Instant purchase option
- **Best Offer**: Non-competitive negotiation format

### Security & Fraud Prevention
- Azure AD B2C authentication (OAuth 2.0/OIDC)
- Credit card pre-authorization before bidding
- 30-day authorization renewal requirement
- Tiered KYC for high-value listings
- No passwords stored in database

### User Dashboard
- Active listings management
- Real-time bid notifications
- Wishlist and saved items
- Transaction history
- Reputation system (ratings & reviews)
- Dispute management
- Payout tracking for sellers

## 📚 Documentation

- [API Documentation](./docs/API.md)
- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Azure Deployment Guide](./docs/DEPLOYMENT.md)
- [Private Room Mechanics](./docs/PRIVATE_ROOM.md)
- [Fraud Prevention](./docs/FRAUD_PREVENTION.md)

## 🧪 Testing

### Backend Tests
```bash
cd backend
npm test
```

### Frontend Tests
```bash
cd frontend
npm test
```

### End-to-End Tests
```bash
cd frontend
npm run e2e
```

## 🚢 Deployment

### Using Azure DevOps
1. Configure Azure DevOps pipeline
2. Set up Azure resources (AKS, Redis, Blob Storage)
3. Configure secrets and environment variables
4. Run deployment pipeline

### Using Docker & Kubernetes
```bash
# Build Docker images
docker-compose build

# Deploy to AKS
kubectl apply -f infrastructure/k8s/
```

See [Deployment Guide](./docs/DEPLOYMENT.md) for detailed instructions.

## 📄 License

Proprietary - All rights reserved

## 👥 Team

Contact: info@bidroom.co

---

**Bidroom** - Where verified value meets decisive wins.

