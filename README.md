# BidRoom

A full-stack application built with Angular frontend and Node.js backend.

## Project Structure

```
BidRoom/
├── frontend/          # Angular application
├── backend/           # Node.js Express API
└── README.md         # This file
```

## Technology Stack

### Frontend
- **Angular** (Latest stable version)
- **TypeScript**
- **HTML5**
- **SCSS/SASS**

### Backend
- **Node.js** (LTS version)
- **Express.js** framework
- **CORS** for cross-origin requests
- **Helmet** for security
- **Morgan** for logging

## Getting Started

### Prerequisites
- Node.js (LTS version)
- npm

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment file:
   ```bash
   cp .env.example .env
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

   The backend will be available at `http://localhost:3000`

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies (already done during creation):
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

   The frontend will be available at `http://localhost:4200`

## Development

- Backend runs on port 3000
- Frontend runs on port 4200
- Backend includes CORS configuration to allow frontend requests
- Hot reload enabled for both frontend and backend during development

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Default
- `GET /` - API information and status

## Environment Variables

Copy `.env.example` to `.env` in the backend directory and configure as needed.

## Scripts

### Backend
- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests

### Frontend
- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run unit tests
- `npm run e2e` - Run end-to-end tests
# Deployment test
# Testing deployment with correct publish profiles
# Fix deployment issues
# Fix frontend deployment issue
# Fix ZIP Deploy issues for both backend and frontend
# Fix 503 errors - configure proper startup commands
# Trigger backend redeployment with correct startup command
# Fix backend ZIP Deploy path issue
