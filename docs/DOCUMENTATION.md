# BidRoom – Technical & Business Documentation

A full-stack auction and marketplace platform supporting **Highest Bid** (time-limited auctions), **Best Offer** (negotiation), and **Private Auction Rooms**. The app powers multiple brands: **BidRoom** (main) and **Casa 27** (Ericeira).

---

## Table of Contents

1. [Application Overview](#application-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture](#architecture)
4. [Environments & White-Labeling](#environments--white-labeling)
5. [Business Rules](#business-rules)
6. [API Reference](#api-reference)
7. [Authentication](#authentication)
8. [Frontend Structure](#frontend-structure)
9. [Backend Structure](#backend-structure)
10. [Deployment](#deployment)

---

## Application Overview

BidRoom is a marketplace where:

- **Sellers** create listings (auctions or best-offer) and manage transactions.
- **Buyers** place bids or submit offers, participate in private rooms, and complete purchases.
- **Admins** moderate disputes, manage users, and oversee auctions.

### Core Features

| Feature | Description |
|--------|-------------|
| **Highest Bid (Auction)** | Time-limited auctions with starting bid, increment, optional reserve, Buy Now, and optional Private Room. |
| **Best Offer** | Buyers submit offers; seller accepts or rejects. Optional minimum offer for auto-accept. |
| **Private Rooms** | After main auction ends, seller invites 2–5 bidders to a private room; 60-second rule determines winner. |
| **Transactions** | Payment window, shipping, proof of delivery, and dispute handling. |
| **Reviews & Reputation** | Post-transaction ratings (1–10), reputation score, trust badges, Private Room eligibility. |
| **Membership & Balance** | User balance for participation; top-ups via Stripe; tier presets (Bronze/Silver/Gold/Platinum). |
| **Stripe Connect** | Sellers can receive payouts via Stripe Connect. |

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Angular** | 20.x | SPA framework |
| **TypeScript** | 5.9.x | Type safety |
| **SCSS** | - | Styling |
| **Firebase Auth** | 11.x | Authentication (email, Google) |
| **Socket.io Client** | 4.8.x | Real-time updates (bids, offers, private rooms) |
| **Stripe.js** | 8.9.x | Payments, Connect onboarding |
| **ngx-translate** | 17.x | i18n (en, pt, es, fr) |
| **SweetAlert2** | 11.x | Alerts and modals |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | ≥20 | Runtime |
| **Express** | 4.18.x | HTTP API |
| **MongoDB / Mongoose** | 8.19.x | Database |
| **Redis (ioredis)** | 5.8.x | Caching, real-time state |
| **Firebase Admin** | 13.x | JWT verification |
| **Socket.io** | 4.8.x | WebSocket server |
| **Stripe** | 20.x | Payments, Connect, webhooks |
| **Nodemailer** | 7.x | Transactional emails |
| **Azure Blob Storage** | 12.x | Image uploads |
| **Helmet** | 7.x | Security headers |
| **Joi / Zod** | - | Validation |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Angular)                       │
│  localhost:4200  │  Firebase Auth  │  Socket.io  │  Stripe.js    │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND (Express)                           │
│  localhost:3000  │  REST API  │  Socket.io  │  Stripe Webhooks   │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   MongoDB    │    │    Redis     │    │ Azure Blob   │
│  (data)      │    │  (cache)     │    │ (uploads)    │
└──────────────┘    └──────────────┘    └──────────────┘
```

- **Frontend** → Backend: Bearer token (Firebase ID token) on each request.
- **Backend** verifies token with Firebase Admin, syncs user in MongoDB.
- **Socket.io** used for live bid/offer updates, private room countdown, notifications.

---

## Environments & White-Labeling

The app supports multiple brands via environment files. Each environment defines:

| Property | Description |
|----------|-------------|
| `title` | App name (e.g. "BidRoom", "Casa 27") |
| `primaryColor` | Theme color (e.g. `#8b5a96`, `#1988c5`) |
| `enableAuctions` | Show auction format |
| `enablePrivateRooms` | Enable private rooms |
| `enableBestOffers` | Enable best-offer format |
| `apiUrl` | Backend API base URL |
| `auctionDurations` | Duration options for listings |
| `logoUrl`, `faviconUrl`, etc. | Branding assets |

### Environment Files

| File | Brand | Use Case |
|------|-------|---------|
| `environment.ts` | BidRoom | Default dev |
| `environment.prod.ts` | BidRoom | Production |
| `environment.ericeira.ts` | Casa 27 | Ericeira dev |
| `environment.ericeira-prod.ts` | Casa 27 | Ericeira production |
| `environment.ericeira-e2e.ts` | Casa 27 | E2E / Azure Static Web App |

### Build Commands

```bash
# BidRoom (default)
npm start
npm run build

# Casa 27 / Ericeira
npm run start:ericeira-e2e
npm run start:ericeira-prod
npm run build:ericeira-e2e
npm run build:ericeira-prod
```

`primaryColor` is applied at runtime via `--primary-color` CSS variable on `app-root`, so `.btn-primary` and other themed elements use the active brand color.

---

## Business Rules

### 1. Auction vs Best Offer

| Aspect | Highest Bid (Auction) | Best Offer |
|--------|------------------------|------------|
| Buyer action | Place bids (public, must meet increment) | Submit offers (amount + optional message) |
| Time | Fixed duration; ends at set time | Sale when seller accepts |
| Winner | Highest bid when time runs out (or Private Room 60s rule) | Seller accepts or rejects |
| Private Room | Optional (2–5 invited bidders) | Not used |
| Buy Now | Optional | Not used |
| Reserve / Min | Optional reserve; seller can decline | Optional min; single offer ≥ min → auto-accept |
| Commission | 2% if Private Room, else 0.5% | 0.5% |

### 2. Private Auction Rooms

- **When:** Highest Bid listing, Private Room enabled, main auction ended, reserve met, ≥2 authenticated bidders.
- **Seller:** Must create room within **1 hour** of auction end; invites 2–5 registered bidders.
- **Invitees:** Must accept within **15 minutes** or lose seat. If no one accepts → no winner.
- **Room end:** **60 seconds** after last bid; each new bid resets the countdown.
- **Winner:** Highest bid when countdown ends; no manual selection.
- **Seller leaves:** Room closes immediately; no winner; all notified.

### 3. Transactions & Disputes

| Phase | Status | Rules |
|-------|--------|-------|
| **Payment** | `pending_payment` | T+24h window; seller provides bank details; buyer pays and can upload proof. |
| **Shipping** | - | Seller ships within handling days; adds tracking; marks Sent. |
| **Receipt** | - | Buyer marks **Received Properly** (complete) or **Received Improperly** (opens dispute). |
| **Dispute** | `dispute_open` | Both accounts suspended; admin rules (buyer/seller/partial); account outcome (reactivate/close). |

### 4. Reviews & Reputation

- **Reviews:** Both parties rate 1–10 after completion; one review per (listing, reviewer, reviewee).
- **Reputation score:** 0–100; penalties for low reviews, dispute losses; recovery via successful transactions.
- **Trust badges:** Verified Funds, Pre-authorized, Private Room Eligible (score ≥60, no dispute losses).
- **Private Room eligibility:** `reputationScore ≥ 60` and `disputeLossCount === 0`.

### 5. Membership & Balance

- **Balance:** Per-user wallet (USD); used for participation.
- **Tiers:** Bronze ($10), Silver ($25), Gold ($100), Platinum ($1,000) – top-up presets only.
- **Platinum Bidders:** Invited private-room bidders; not the same as Platinum tier.
- **Top-up:** Stripe Checkout; idempotent via `creditedStripeSessionIds`; webhook fallback.

### 6. Account Status

| Status | Effect |
|--------|--------|
| `active` | Full access |
| `suspended` | No listings, bids, offers, transactions (e.g. during dispute) |
| `closed` | Permanently disabled |

---

## API Reference

### Base URL

- Dev: `http://localhost:3000/api`
- Prod: Configured per environment (`apiUrl`)

### Main Routes

| Prefix | Purpose |
|--------|---------|
| `/api/auth` | Login, register, Firebase token sync |
| `/api/listings` | CRUD listings, search, filters |
| `/api/bids` | Place bids, bid history |
| `/api/offers` | Create/accept/reject offers |
| `/api/private-room` | Create room, invite, accept, bid in room |
| `/api/transactions` | Payment, shipping, disputes |
| `/api/customers` | Profile, balance |
| `/api/payments` | Checkout, top-ups, confirm session |
| `/api/connect` | Stripe Connect onboarding, payouts |
| `/api/reviews` | Create review, reputation |
| `/api/watchlist` | Watchlist |
| `/api/uploads` | Image upload (Azure Blob) |
| `/api/notifications` | In-app notifications |
| `/api/admin` | Admin panel (disputes, users, auctions) |
| `/api/shipping` | Shipping options |

### Health & Default

- `GET /` – API info
- `GET /health` – Health check

---

## Authentication

- **Provider:** Firebase Authentication (email/password, Google).
- **Flow:** User signs in → Firebase ID token → sent as `Authorization: Bearer <token>`.
- **Backend:** Verifies token with Firebase Admin; creates/updates user in MongoDB.
- **Guards:** `AuthGuard` for protected routes; `AdminGuard` for admin (email allowlist).
- **Email verification:** Required before login; unverified users are signed out.

---

## Frontend Structure

```
frontend/src/
├── app/
│   ├── admin/           # Admin panel (nexus)
│   ├── auth/            # Login, signup, forgot password, verify email
│   ├── dashboard/       # User dashboard (home, buyer, seller, disputes, notifications, settings)
│   ├── landing/         # Home, FAQ, contact, how-it-works
│   ├── listing/         # Listing list, details, add-listing
│   ├── private-room/    # Private room auction UI
│   └── shared/          # Header, footer, services, config
├── environments/        # Environment configs
└── public/
    └── i18n/            # en.json, pt.json, es.json, fr.json
```

### Routing

| Path | Module | Auth |
|------|--------|------|
| `/` | Redirect to `/landing` | - |
| `/auth/*` | Auth (login, signup, etc.) | - |
| `/landing` | Landing | - |
| `/listing/*` | Listings, details, add | Some guarded |
| `/dashboard/*` | Dashboard | Required |
| `/nexus/*` | Admin | Admin only |
| `/private-room/*` | Private room | Required |

---

## Backend Structure

```
backend/src/
├── index.js             # Express app, Socket.io, routes
├── config/              # Database, env
├── models/              # Listing, Bid, Offer, User, Transaction, etc.
├── routes/              # auth, listings, bids, offers, privateRoom, etc.
├── services/            # redis, azureStorage, invoice, reputation, etc.
├── middleware/          # Auth, validation
└── email-templates/     # Email templates
```

### Key Models

- **Listing** – Auction format, duration, reserve, Buy Now, Private Room, shipping, etc.
- **Bid** – Listing, user, amount, timestamp.
- **Offer** – Listing, user/email, amount, message, status.
- **Transaction** – Listing, buyer, seller, status, payment, shipping, dispute.
- **User** – Firebase UID, email, reputation, account status.
- **Customer** – Balance, Stripe IDs.
- **Dispute** – Transaction, evidence, admin ruling.

---

## Deployment

### Local Development

1. **Backend:** `cd backend` → `npm install` → `npm run dev` (port 3000).
2. **Frontend:** `cd frontend` → `npm install` → `npm start` (port 4200).
3. Configure `backend/.env` (MongoDB, Redis, Stripe, Firebase, etc.).

### Azure

- **Backend:** Node.js App Service (`bidroom-backend-dev`).
- **Frontend:** Azure Static Web App (`bidroom-frontend-dev` or Casa 27 E2E).
- **Redis:** Azure Cache for Redis.
- **Storage:** Azure Blob for uploads.

See [docs/AZURE_DEPLOYMENT.md](docs/AZURE_DEPLOYMENT.md) for setup and scripts.

### Environment Variables (Backend)

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | MongoDB connection |
| `JWT_SECRET` | JWT signing (if used) |
| `FRONTEND_URL` | CORS, redirects |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe |
| `FIREBASE_PROJECT_ID`, etc. | Firebase Admin |
| `AZURE_STORAGE_*` | Blob storage |
| `EMAIL_*` | Nodemailer |

---

## Related Documentation

- [AUCTION-VS-BEST-OFFER.md](docs/AUCTION-VS-BEST-OFFER.md) – Auction vs Best Offer details
- [PRIVATE-AUCTION-ROOMS.md](docs/PRIVATE-AUCTION-ROOMS.md) – Private room flow
- [TRANSACTIONS-AND-DISPUTES.md](docs/TRANSACTIONS-AND-DISPUTES.md) – Transaction and dispute lifecycle
- [REVIEW-AND-REPUTATION-SYSTEM.md](docs/REVIEW-AND-REPUTATION-SYSTEM.md) – Reviews and reputation
- [MEMBERSHIP.md](docs/MEMBERSHIP.md) – Balance and tiers
- [HOW_TO_RUN.md](docs/HOW_TO_RUN.md) – Local setup
- [AZURE_DEPLOYMENT.md](docs/AZURE_DEPLOYMENT.md) – Azure deployment
