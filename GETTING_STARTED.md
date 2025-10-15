# Getting Started with Bidroom

Welcome to Bidroom! This guide will help you set up and run the project locally.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **npm** (v9 or higher) - Comes with Node.js
- **MongoDB** - [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (free tier) or local installation
- **Redis** - Local installation or [Redis Cloud](https://redis.com/try-free/)
- **Angular CLI** - Install globally: `npm install -g @angular/cli`
- **Docker** (optional) - For containerized development
- **Git** - For version control

## Project Structure

```
bidroom/
├── backend/                 # Node.js/Express backend
│   ├── src/
│   │   ├── config/         # Configuration files
│   │   ├── controllers/    # Route controllers (to be added)
│   │   ├── middleware/     # Express middleware
│   │   ├── models/         # MongoDB/Mongoose models
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic (to be added)
│   │   ├── sockets/        # Socket.io handlers
│   │   ├── utils/          # Utility functions
│   │   └── server.ts       # Main server file
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/               # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/      # Core services and guards
│   │   │   ├── shared/    # Shared components and modules
│   │   │   ├── features/  # Feature modules
│   │   │   │   ├── landing/    # Landing page
│   │   │   │   ├── auctions/   # Auction features
│   │   │   │   ├── dashboard/  # User dashboard
│   │   │   │   └── auth/       # Authentication
│   │   │   └── app.module.ts
│   │   ├── environments/  # Environment configurations
│   │   └── styles.scss
│   ├── package.json
│   └── angular.json
│
├── infrastructure/         # Deployment configurations
│   ├── kubernetes/        # K8s manifests
│   └── azure/            # Azure Bicep templates
│
├── docs/                  # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DEPLOYMENT.md
│   └── PRIVATE_ROOM.md
│
├── docker-compose.yml     # Docker Compose for local dev
├── .gitignore
└── README.md
```

## Quick Start (Local Development)

### Option 1: Using Docker Compose (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd bidroom
   ```

2. **Set up environment variables**
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with your configurations
   ```

3. **Start all services**
   ```bash
   docker-compose up
   ```

   This will start:
   - MongoDB (port 27017)
   - Redis (port 6379)
   - Backend API (port 3000)
   - Frontend (port 4200)

4. **Access the application**
   - Frontend: http://localhost:4200
   - Backend API: http://localhost:3000
   - API Health: http://localhost:3000/health

### Option 2: Manual Setup

#### 1. Set Up Backend

```bash
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your MongoDB and Redis credentials
# nano .env or use your preferred editor

# Run in development mode
npm run dev
```

The backend will start on http://localhost:3000

#### 2. Set Up Frontend

Open a new terminal:

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

The frontend will start on http://localhost:4200

## Environment Configuration

### Backend (.env)

Create `backend/.env` with the following:

```env
NODE_ENV=development
PORT=3000

# MongoDB
MONGODB_URI=mongodb://localhost:27017/bidroom

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=your-secret-key-change-in-production

# Azure AD B2C (Optional for local dev)
AZURE_AD_B2C_TENANT_NAME=
AZURE_AD_B2C_CLIENT_ID=
AZURE_AD_B2C_CLIENT_SECRET=

# Stripe (Optional for local dev)
STRIPE_SECRET_KEY=
```

### Frontend (environment.ts)

The frontend environment is already configured for local development in:
`frontend/src/environments/environment.ts`

## Database Setup

### MongoDB

#### Option A: MongoDB Atlas (Cloud)

1. Create account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster
3. Create database user
4. Whitelist your IP (or allow from anywhere for development)
5. Get connection string and add to `backend/.env`

#### Option B: Local MongoDB

1. Install MongoDB locally
2. Start MongoDB service
3. Use connection string: `mongodb://localhost:27017/bidroom`

### Redis

#### Option A: Redis Cloud

1. Create account at [Redis Cloud](https://redis.com/try-free/)
2. Create free database
3. Get connection details and add to `backend/.env`

#### Option B: Local Redis

1. Install Redis locally
2. Start Redis service: `redis-server`
3. Default connection: `localhost:6379`

## Azure AD B2C Setup (Optional)

For authentication to work, you'll need to set up Azure AD B2C:

1. Create Azure AD B2C tenant
2. Register application
3. Create user flow (B2C_1_signupsignin)
4. Configure redirect URIs:
   - http://localhost:4200/auth/callback (development)
5. Update environment files with credentials

For development, you can skip this and implement mock authentication.

## Running Tests

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

## Common Issues & Solutions

### Port Already in Use

If ports 3000 or 4200 are in use:

```bash
# Kill process on port 3000 (backend)
lsof -ti:3000 | xargs kill -9

# Kill process on port 4200 (frontend)
lsof -ti:4200 | xargs kill -9
```

Or change ports in configuration files.

### MongoDB Connection Error

- Check MongoDB is running
- Verify connection string in `.env`
- Check firewall/network settings

### Redis Connection Error

- Check Redis is running: `redis-cli ping` (should return PONG)
- Verify Redis host/port in `.env`

### Module Not Found

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

### 1. Explore the Codebase

- Backend models: `backend/src/models/`
- API routes: `backend/src/routes/`
- Frontend services: `frontend/src/app/core/services/`
- Landing page: `frontend/src/app/features/landing/`

### 2. Review Documentation

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [API Documentation](./docs/API.md)
- [Private Room Mechanics](./docs/PRIVATE_ROOM.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)

### 3. Development Tasks

The project structure is set up, but you'll need to:

- [ ] Implement controller logic in backend
- [ ] Create additional Angular components
- [ ] Implement auction listing pages
- [ ] Build user dashboard
- [ ] Add payment integration
- [ ] Implement image upload
- [ ] Create admin panel
- [ ] Write comprehensive tests

### 4. Configure Third-Party Services

- **Stripe**: For payment processing
- **Azure Blob Storage**: For image uploads
- **SendGrid/Azure Communication**: For emails
- **Azure Application Insights**: For monitoring

## Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes and test locally**

3. **Commit your changes**
   ```bash
   git add .
   git commit -m "Description of changes"
   ```

4. **Push to repository**
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create pull request** for review

## Useful Commands

### Backend

```bash
npm run dev          # Start development server
npm run build        # Build TypeScript
npm test            # Run tests
npm run lint        # Run linter
npm run lint:fix    # Fix linting issues
```

### Frontend

```bash
npm start           # Start dev server
npm run build       # Build for production
npm test           # Run tests
npm run lint       # Run linter
```

### Docker

```bash
docker-compose up              # Start all services
docker-compose up -d          # Start in background
docker-compose down           # Stop all services
docker-compose logs -f        # View logs
docker-compose ps             # List services
```

## Getting Help

- **Documentation**: Check the `/docs` folder
- **Issues**: Create an issue on GitHub
- **Questions**: Contact the development team

## Resources

- [Angular Documentation](https://angular.io/docs)
- [Express.js Guide](https://expressjs.com/)
- [MongoDB Manual](https://docs.mongodb.com/)
- [Socket.IO Documentation](https://socket.io/docs/)
- [Azure Documentation](https://docs.microsoft.com/azure/)
- [Stripe API](https://stripe.com/docs/api)

---

**Happy coding! 🚀**

*Bidroom - Verified Value. Decisive Win.*

