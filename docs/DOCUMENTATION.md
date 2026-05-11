# BidRoom – Technical & Business Documentation

A full-stack auction and marketplace platform supporting **Highest Bid** (time-limited auctions), **Best Offer** (negotiation), and **Private Auction Rooms**. The stack is organised so branding and API URLs can vary per deployment (Angular `environment` files plus optional runtime `APP_CONFIG` in `index.html`).

---

## Table of Contents

1. [Application Overview](#application-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture](#architecture)
4. [Environments & Configuration](#environments--configuration)
5. [Business Rules](#business-rules)
6. [API Reference](#api-reference)
7. [Authentication](#authentication)
8. [Compliance, Moderation & Trust](#compliance-moderation--trust)
9. [Frontend Structure](#frontend-structure)
10. [Backend Structure](#backend-structure)
11. [Deployment](#deployment)

---

## Application Overview

BidRoom is a marketplace where:

- **Sellers** create listings (auctions or best-offer) and manage transactions.
- **Buyers** place bids or submit offers, participate in private rooms, and complete purchases.
- **Admins** moderate disputes, reports, damage claims, review flags and appeals, and oversee platform health.

### Core Features

| Feature | Description |
|--------|-------------|
| **Highest Bid (Auction)** | Time-limited auctions with starting bid, increment, optional reserve, Buy Now, and optional Private Room. |
| **Best Offer** | Buyers submit offers; seller accepts or rejects. Optional minimum offer for auto-accept. |
| **Private Rooms** | After main auction ends, seller has **15 minutes** to invite 2–5 bidders (countdown on listing); accept/refuse within 15 minutes; poker-table room UI; **1-minute** start when all accept; then **60-second** rule for bidding. See [PRIVATE-AUCTION-ROOMS.md](./PRIVATE-AUCTION-ROOMS.md). |
| **Transactions** | Payment window, shipping deadlines (5 business days warning + auto-cancel + Stripe refund), proof of delivery, disputes, optional **delivery auto-complete** after a shipped order window, **return requests** with seller response deadlines and platform mediation fallback. Full lifecycle: [TRANSACTIONS-AND-DISPUTES.md](./TRANSACTIONS-AND-DISPUTES.md). |
| **Damage claims** | Buyer can open an **in-transit damage** claim within **48 hours** of confirming delivery (photo evidence required); API at `/api/damage-claims`. |
| **Reviews & reputation** | Post-transaction ratings (1–10), reputation score, trust badges, Private Room eligibility, **automatic 5★ reviews** for missing parties **5 days** after terminal transaction states (scheduled job). Details: [REVIEW-AND-REPUTATION-SYSTEM.md](./REVIEW-AND-REPUTATION-SYSTEM.md). |
| **Membership & balance** | User wallet and Stripe top-ups; tier presets gated by **`FEATURE_MEMBERSHIP_TIERS`** (backend env) and mirrored in frontend `featureFlags.membershipTiers`. See [MEMBERSHIP.md](./MEMBERSHIP.md). |
| **Stripe Connect** | Seller payouts via Connect; onboarding and webhooks. |
| **KYC (Stripe Identity)** | Listings priced **≥ $5,000** and bids **≥ $5,000** require **`kycStatus: approved`** (document + selfie). Session at `POST /api/kyc/session`, webhook at `/api/kyc/webhook`. |
| **Seller / buyer profiles** | Public **`/seller/:idOrSlug`** page — accepts both the Mongo `_id` (24-char hex, backward-compatible) and a human-readable **slug** (e.g. `/seller/johnwatches`). Slugs are auto-generated from `firstName + lastName` on first save, normalised (diacritics stripped, spaces→hyphens, lowercase) and guaranteed unique with a numeric suffix when needed. API: `GET /api/users/:id/profile`. |
| **Following** | **`/api/follows`** — follow/unfollow sellers, mute notifications for a seller. **`/api/category-follows`** — follow categories for discovery. Dashboard route **`/dashboard/following`**. Followed seller links use slug when available. |
| **Reports** | `POST /api/reports` — report a **listing** or **user** with fixed reason codes (fraud, offensive content, etc.); duplicates rejected. |
| **Notifications** | In-app inbox with **unread dot indicators**, **unread count badge**, and **mark-all-as-read** action. Socket.io **`join-user`** room, **email + push + in-app** preferences per event type, **`GET/PATCH /api/notifications/preferences`**, signed **global email unsubscribe** (`/notifications/unsubscribe` in SPA + **`GET /api/notifications/unsubscribe?token=`**). |
| **Content safety** | **Azure AI Content Safety** optional scan on **image uploads** (`AZURE_CONTENT_SAFETY_*`); server-side blocking/flag thresholds. **`contentViolationService`** escalation for repeated attempts to share **contact info outside the platform**. |
| **DSA compliance monitoring** | Daily scheduler checks **`sellerClassification: private`** sellers against **trailing 12-month** transaction **volume (> €2,000)** and **count (> 30)** (Article 29 thresholds). Issues in-app + email warning → user acknowledges via dashboard banner → `suspectedProfessional` flag or optional `dsaListingRestricted` enforcement after grace period. |

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Angular** | 20.x | SPA framework |
| **TypeScript** | ~5.9.x | Type safety |
| **SCSS** | - | Styling |
| **Angular Fire** | 20.x | Firebase bindings |
| **Firebase Auth** | 11.x | Authentication (email, Google, etc.) |
| **Socket.io Client** | 4.8.x | Real-time listings, private rooms, notifications |
| **Stripe.js** | 8.9.x | Payments, Identity return flow, Connect |
| **ngx-translate** | 17.x | i18n (`public/i18n/`: en, pt, es, fr) |
| **SweetAlert2** | 11.x | Alerts and modals |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | ≥20 | Runtime |
| **Express** | 4.18.x | HTTP API |
| **MongoDB / Mongoose** | 8.19.x | Database |
| **Redis (ioredis)** | 5.8.x | Caching; optional **Socket.io Redis adapter** for multi-instance |
| **Firebase Admin** | 13.x | JWT verification |
| **Socket.io** | 4.8.x (+ **@socket.io/redis-adapter** 8.x) | WebSocket server |
| **Stripe** | 20.x | Payments, Connect, **Identity**, webhooks |
| **Nodemailer** | 7.x | Transactional emails |
| **Azure Blob Storage** | 12.x | Image uploads |
| **Azure AI Content Safety** | REST client | Uploaded image moderation |
| **pdfkit** | - | Invoice / receipt PDFs |
| **Helmet** | 7.x | Security headers |
| **express-rate-limit** | 8.x | Endpoint group throttling |
| **Joi** | 18.x | Validation |
| **Zod** | 4.x | Validation (additional routes/schemas) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Angular)                       │
│  localhost:4200  │  Firebase Auth  │  Socket.io  │  Stripe.js   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND (Express)                           │
│  REST API │ Socket.io │ Stripe webhooks (payments, Connect, KYC)│
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   MongoDB    │    │    Redis     │    │ Azure Blob   │
│  (data)      │    │  (cache +    │    │ (uploads)    │
│              │    │   socket IO) │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
```

- **Frontend → Backend:** `Authorization: Bearer <Firebase ID token>`; optional **`X-Device-Fingerprint`** header (used with anti-abuse helpers).
- **Backend:** Verifies token with Firebase Admin; syncs user in MongoDB.
- **Socket.io:** Listing / private-room viewer counts, live bid/offer activity, **per-user** notification channel (`user:<uid>`). With **`REDIS_HOST`** set, the **Redis adapter** fans out events across App Service instances (fail-open to single-node if adapter setup fails).
- **CORS:** `FRONTEND_URL`, `FRONTEND_URL_PROD`, **`CORS_EXTRA_ORIGINS`**, localhost, and `*.azurestaticapps.net`.

---

## Environments & Configuration

### Angular `environment` (`frontend/src/environments/`)

Files: **`environment.ts`** (dev) and **`environment.prod.ts`** (production build via `fileReplacements` in `angular.json`).

| Area | Properties |
|------|------------|
| **API** | `defaultApiBaseUrl` — must include `/api` suffix when pointing at the API (see `api.config.ts`). |
| **Runtime override** | Deployed sites can set **`window.APP_CONFIG.API_URL`** and **`window.APP_CONFIG.STRIPE_PUBLISHABLE_KEY`** in `index.html` (or CI injection) so the same build targets different backends. |
| **Features** | `featureFlags`: `auctions`, `privateRooms`, `bestOffers`, `reviews`, **`membershipTiers`** (UI; align with backend `FEATURE_MEMBERSHIP_TIERS`). |
| **Theme** | `theme.primaryColor`, `secondaryColor`, `backgroundColor` — applied as CSS variables for branding. |
| **Listing helpers** | `auctionDurations`, `shippingOptions`, `handlingTimes`, `returnPolicies`, fee display rates. |

### Backend public feature flags

- **`GET /api/config`** — returns `{ features }` from **`config/features.js`** (currently **`membershipTiers`** from env **`FEATURE_MEMBERSHIP_TIERS=true`**).

### Local scripts

```bash
cd frontend && npm install && npm start    # dev server, default port 4200
cd frontend && npm run build               # production build (uses environment.prod.ts)
```

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
- **Seller:** Must create the room and send invitations within **15 minutes** of auction end (**countdown** on the listing page); invites **2–5** registered bidders.
- **Invitees:** Must **accept or refuse** within **15 minutes** or become ineligible. **Edge case:** Only **two** invitees and **one** does not respond in time → the **other** is selected as **winner** without a bidding phase.
- **Room access & UI:** Anyone can view; **poker-table** layout; **countdown** until the private auction opens; when **all** have accepted, opening countdown reduces to **1 minute**.
- **Bidding:** **60 seconds** after last bid; each new bid resets the countdown.
- **Winner:** Highest bid when the 60-second countdown ends (except the two-invitee timeout case above).
- **Seller leaves:** Room closes immediately; no winner; all notified.

Full detail: [PRIVATE-AUCTION-ROOMS.md](./PRIVATE-AUCTION-ROOMS.md).

### 3. Transactions, Delivery & Disputes

| Phase | Status | Rules (summary) |
|-------|--------|------------------|
| **Payment** | `pending_payment` | Buyer pays via Stripe Connect (checkout or confirm flows). |
| **Shipping** | `awaiting_seller_acceptance` → `paid` | **5 business days** (Mon–Fri UTC) to ship — midpoint warning, day-5 auto-cancel + refund; buyer **remind** endpoint on transactions. |
| **Shipped → delivered** | `shipped` | **Delivery scheduler:** if buyer does not confirm, **auto-complete** releases seller payout after **`autoReleaseAt`** (estimated delivery + buffer or shipped + max window — see [`deliveryAutoReleaseScheduler.js`](../backend/src/services/deliveryAutoReleaseScheduler.js)). |
| **Returns** | Various | Buyer return flow; **48h seller response**; if missed → **`platform_mediated`** for staff (same scheduler). |
| **Receipt / dispute** | `delivered` / `under_dispute` | Buyer confirms properly or improperly; disputes suspend accounts pending admin verdict. |

**`PATCH /api/transactions/:id` response** includes a `role` field (`"buyer"` or `"seller"`) so the frontend can correctly determine the current user's side after any status update without requiring a separate profile fetch.

### 4. Damage claims (implemented)

- **Who:** Buyer only.
- **When:** Within **48 hours** of **`deliveredAt`**.
- **Evidence:** At least one **damage** photo URL and one **packaging** photo URL (Azure-hosted uploads).

### 5. Reviews & Reputation

- **Reviews:** Both parties rate 1–10 after completion; one review per (listing, reviewer, reviewee).
- **Auto-reviews:** If neither side submits within **5 days** of **`completed`** or **`cancelled`**, the scheduler creates reciprocal **auto-generated** reviews (neutral-to-positive defaults) so silent deals do not penalise scores.
- **Reputation score:** 0–100; penalties for low reviews / dispute losses; recovery via healthy transactions.
- **Trust badges & Private Room eligibility:** As documented in [REVIEW-AND-REPUTATION-SYSTEM.md](./REVIEW-AND-REPUTATION-SYSTEM.md).

### 6. Membership & Balance

- **Balance:** Per-user wallet; Stripe top-ups idempotent via session tracking.
- **Tiers:** Preset amounts — UI and offer metadata align with **`FEATURE_MEMBERSHIP_TIERS`** when enabled.

### 7. Seller classification & DSA compliance (private vs professional)

Users have a **`sellerClassification`** field: **`private`** (default) or **`professional`**.

#### Automatic monitoring — `dsaComplianceScheduler`

A **daily** background job (first run 5 minutes after server start; configurable interval) aggregates each private seller's **trailing 12-month** completed transactions:

| Threshold | Value |
|-----------|-------|
| Annual sales value | **> €2,000** |
| Annual transaction count | **> 30** |

When either threshold is crossed:

1. **First breach** — a `dsaWarningIssuedAt` timestamp is recorded on `User`; an **in-app notification** (`notifyDsaWarning`) and a **warning email** (`sendDsaWarningEmail`) are sent describing the thresholds and the required action.
2. **Grace period** — if the seller has an unacknowledged warning older than **30 days** and still exceeds thresholds, `suspectedProfessional = true` is set and (optionally) `dsaListingRestricted = true`, which blocks new listings (`POST /api/listings` returns HTTP 403).
3. **Already notified** — the scheduler skips sellers who were notified in the last **7 days** to avoid repeated emails.

#### User acknowledgement flow

The seller sees a **banner on the dashboard home** (`showDsaWarningBanner`) while `dsaWarningIssuedAt` is set and `dsaWarningAcknowledgedAt` is null. The banner offers two choices:

| Action | Button | Effect |
|--------|--------|--------|
| Register as a professional trader | "Switch to professional" | Calls `POST /api/customers/dsa-warning-response` with `response: "switch_professional"`; clears `suspectedProfessional` and `dsaListingRestricted`; seller is then expected to submit trader details via `PATCH /api/customers/seller-compliance`. |
| Remain private | "Remain private" | Same endpoint with `response: "remain_private"`; sets `suspectedProfessional: true` internally. |
| Dismiss temporarily | × | Client-side only (`dsaWarningDismissed = true`); banner reappears on next page load until formally acknowledged. |

#### Professional seller verification

`PATCH /api/customers/seller-compliance` with `sellerClassification: "professional"` requires:

| Field | Max length |
|-------|-----------|
| `professionalLegalName` | 300 |
| `professionalAddressLine1` | 300 |
| `professionalCity` | 120 |
| `professionalRegion` | 120 |
| `professionalPostalCode` | 32 |
| `professionalCountry` | 2 (ISO-2) |
| `professionalContactPhone` | 40 |
| `professionalContactEmail` | 254 |
| `professionalVatId` | 64 |
| `professionalTradeName` *(optional)* | 300 |
| `professionalAddressLine2` *(optional)* | 300 |

Status moves to `professionalVerificationStatus: "pending"` until admin verifies. Resubmitting identical data when already `"verified"` is a no-op.

Switching back to `"private"` clears all professional fields and resets status to `"none"`.

### 8. Seller profile slugs

Every `User` document has a **`slug`** field (sparse unique index, lowercase, trimmed).

- **Generation:** A Mongoose `pre('save')` hook calls `buildSlugBase(firstName, lastName)` — normalises Unicode diacritics, strips non-alphanumeric characters, joins with hyphens — and then `generateUniqueSlug(base, excludeId)` which appends an incrementing numeric suffix (`-2`, `-3`, …) until the slug is unique in the collection.
- **Backward compatibility:** `GET /api/users/:id/profile` (and reviews) accept either a **24-character hex ObjectId** or a **slug string**. The `resolveUser` helper detects the format and queries accordingly. Frontend templates fall back to `listing.seller._id` when slug is absent (e.g. for listings created before the feature).
- **Listing links:** `[routerLink]="['/seller', listing.seller.slug || listing.seller._id]"` — same pattern in the following list.
- **Migration:** `backend/src/scripts/backfillUserSlugs.js` is a one-off script that generates slugs for all existing users who lack one.

### 9. Account Status

| Status | Effect |
|--------|--------|
| `active` | Full access (subject to KYC and content restrictions) |
| `suspended` | No listings, bids, offers, transactions (e.g. dispute or policy) |
| `closed` | Permanently disabled |

Temporary **content** restrictions may also apply (`contentRestrictedUntil`) before full suspension on repeated contact-info violations.

---

## API Reference

### Base URL

- Dev: `http://localhost:3000/api`
- Prod: `defaultApiBaseUrl` or `APP_CONFIG.API_URL` on the client

### Main route prefixes

| Prefix | Purpose |
|--------|---------|
| `/api/auth` | Login/register flows, Firebase token sync |
| `/api/listings` | CRUD, search, filters, slugs, content checks; `POST` blocked when `dsaListingRestricted` |
| `/api/bids` | Place bids (KYC + bid rate-limit helpers) |
| `/api/offers` | Best-offer CRUD accept/reject |
| `/api/private-room` | Rooms, invitations, bids |
| `/api/transactions` | Payment, shipping, disputes, reminders, returns; PATCH responses include `role` field |
| `/api/customers` | Profile, balance, Stripe customer, `sellerClassification`, `/dsa-warning-response`, `/seller-compliance` |
| `/api/payments` | Checkout, top-ups (`/webhook` — raw body) |
| `/api/connect` | Connect onboarding (`/webhook` — raw body) |
| `/api/kyc` | **`/status`**, **`/session`**, **`/webhook`** (Identity events) |
| `/api/reviews` | Reviews, flags, appeals (rate-limited) |
| `/api/watchlist` | Watchlist |
| `/api/uploads` | Image upload to Blob (+ optional Content Safety scan) |
| `/api/notifications` | Notifications, `PATCH /mark-all-read`, **preferences**, public unsubscribe GET |
| `/api/admin` | Admin panel (**`ADMIN_EMAILS`** allowlist); disputes, audits, KPIs |
| `/api/shipping` | Labels / rates where integrated |
| `/api/config` | Public feature flags |
| `/api/reports` | User/listing reports |
| `/api/users` | `/:id/profile` (ObjectId or slug), follower counts |
| `/api/follows` | Follow/unfollow/mute seller; returns `slug` for followed sellers |
| `/api/category-follows` | Category watch list |
| `/api/damage-claims` | Damage-in-transit claims |

### Selected customer endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/customers/profile` | Full profile including `sellerCompliance`, `dsaWarning`, `theme`. |
| `PATCH` | `/api/customers/seller-compliance` | Set seller classification and (for professionals) trader identity. |
| `POST` | `/api/customers/dsa-warning-response` | Acknowledge DSA warning: `{ response: "remain_private" \| "switch_professional" }`. |
| `PATCH` | `/api/customers/language` | Update preferred language. |
| `PATCH` | `/api/customers/theme` | Persist UI theme preference (`light` / `dark` / `system`). |

### Health & defaults

- `GET /` — API info JSON
- `GET /health` — liveness (`status`, `uptime`)

---

## Authentication

- **Provider:** Firebase Authentication (email/password, Google, etc.) via **`@angular/fire`** on the client.
- **Flow:** User signs in → Firebase ID token → **`Authorization: Bearer <token>`** on API calls.
- **Backend:** **`firebase-admin`** verifies the token and resolves the Mongo **`User`**.
- **Guards:** **`AuthGuard`** (dashboard), **`AdminGuard`** (nexus admin — aligns with **`ADMIN_EMAILS`** on server).
- **Email verification:** Enforced before full access where configured in auth flows.

---

## Compliance, Moderation & Trust

| Mechanism | Role |
|-----------|------|
| **Stripe Identity** | AML-style step-up for **high-value** bids/listings (≥ **$5,000**). |
| **Reports** | Structured reporting for listings and users. |
| **Review flags & appeals** | Admin workflow via **`/api/admin`** and related models. |
| **Content filter** | Blocks PII / off-platform contact in user-generated text; escalates to temp restriction or suspension. |
| **Azure Content Safety** | Optional automated image scoring on upload. |
| **Moderation audit** | **`ModerationAuditLog`** and related services for traceability; `seller_compliance_updated` events recorded on every classification change. |
| **Proof-of-payment cleanup** | Scheduled Azure Blob deletion after retention (paid transactions). |
| **DSA compliance job** | 24-hour scheduler (`dsaComplianceScheduler`) for Article 29 private seller volume/count thresholds. Issues warning, records `suspectedProfessional`, optionally enforces `dsaListingRestricted`. Customer acknowledgement via `POST /api/customers/dsa-warning-response`. |

---

## Frontend Structure

```
frontend/src/
├── app/
│   ├── admin/              # Nexus — disputes, moderation, KPIs (guard: admin)
│   ├── auth/               # Login, signup, forgot password, verify email
│   ├── dashboard/          # home (payout banner, DSA banner, stats, listings preview, reviews),
│   │                       # buyer & seller hubs, disputes,
│   │                       # notifications (unread indicators, mark-all-read),
│   │                       # settings, following (slug-linked seller cards), seller analytics
│   │                       # (+ legacy redirects: my-account → settings, etc.)
│   ├── landing/            # Home, FAQ, contact, how-it-works, privacy, terms
│   ├── listing/            # categories, list, add/edit/detail (slug seller links), choose-winner
│   ├── private-room/       # Private room auction UI
│   ├── profile/            # seller-public-profile (public /seller/:idOrSlug)
│   ├── notifications/      # unsubscribe page (token from email)
│   └── shared/             # Shell, services, guards, interceptors (auth, fingerprint), config
├── environments/
└── public/
    └── i18n/
```

### Routing (high level)

| Path | Purpose | Auth |
|------|---------|------|
| `/` | → `/landing` | - |
| `/auth/*` | Auth flows | - |
| `/landing/*` | Marketing + legal pages | - |
| `/listing/*` | Marketplace | Mixed |
| `/dashboard/*` | User hub | **AuthGuard** |
| `/seller/:idOrSlug` | Public seller profile | - |
| `/nexus/*` | Admin | **AdminGuard** |
| `/private-room/*` | Private auctions | Typical flows require login |
| `/notifications/unsubscribe` | Email unsubscribe UI | Token in query |

### Dashboard home banners

The dashboard home (`/dashboard`) renders banners above the stats grid in priority order:

1. **Account status banner** — shows when `accountStatus` is `suspended` or `closed`.
2. **Payout setup banner** — shown when `stripeConnectOnboarded` is false; includes a CTA link to the Stripe Connect onboarding flow and a dismiss button (session-scoped).
3. **DSA warning banner** — shown when `dsaWarning.warningIssuedAt` is set and `dsaWarning.acknowledgedAt` is null; offers "Switch to professional" and "Remain private" actions, plus a session-scope dismiss.

---

## Backend Structure

```
backend/src/
├── index.js                 # Express, CORS, rate limits, webhooks (raw body), Socket.io + Redis adapter, schedulers
├── config/                  # database, firebaseAdmin, features, packaging policy
├── models/                  # Listing, Bid, Offer, Transaction, User (slug, DSA fields), Customer,
│                            # Notification, Review (+ ReviewFlag / ReviewAppeal), Report, Follow,
│                            # CategoryFollow, DamageClaim, Watchlist, NotificationPreferences,
│                            # audit/fraud drafts, ...
├── routes/                  # auth, listings, bids, offers, privateRoom, customers, transactions,
│                            # payments, connect, kyc, reviews, watchlist, uploads, notifications,
│                            # admin, shipping, config, reports, users, follows, category-follows,
│                            # damage-claims
├── services/
│   ├── auctionEndScheduler.js
│   ├── shippingDeadlineScheduler.js
│   ├── deliveryAutoReleaseScheduler.js   # auto-complete + return mediation timeouts
│   ├── reviewAutoGenerateScheduler.js    # mutual auto-reviews after 5 days
│   ├── dsaComplianceScheduler.js         # Article 29 private seller threshold checks (daily)
│   ├── notificationService.js            # create + Socket.io emit; notifyDsaWarning, notifyDsaSuspectedProfessional
│   ├── emailService.js
│   ├── invoiceService.js
│   ├── reputationService.js
│   ├── accountStatusService.js
│   ├── contentViolationService.js
│   ├── contentSafetyService.js            # Azure image scan
│   ├── moderationAuditService.js
│   ├── proofOfPaymentCleanup.js
│   └── redis.service.js, azureStorage.service.js, shipping*, ...
├── scripts/
│   └── backfillUserSlugs.js              # one-off migration: generate slugs for existing users
├── middleware/              # auth, bidRateLimiter, validation
└── email-templates/
```

### User model — key fields added

| Field | Type | Purpose |
|-------|------|---------|
| `slug` | String, unique sparse | Human-readable profile URL segment; auto-generated on first save. |
| `dsaWarningIssuedAt` | Date | Timestamp when the DSA threshold warning was first issued. |
| `dsaWarningAcknowledgedAt` | Date | Timestamp when the seller formally acknowledged the warning. |
| `dsaWarningResponse` | String | `"remain_private"` or `"switch_professional"`. |
| `suspectedProfessional` | Boolean | Set when seller chooses to remain private after warning or after grace period. |
| `dsaListingRestricted` | Boolean | Blocks new listing creation when true. |

---

## Deployment

### Local development

1. **Backend:** `cd backend` → `npm install` → `npm run dev` (port **3000**).
2. **Frontend:** `cd frontend` → `npm install` → `npm start` (port **4200**).
3. Configure **`backend/.env`** (MongoDB, Redis, Stripe, Firebase, Azure, **`ADMIN_EMAILS`**, optional Content Safety).

### Azure (typical)

- **Backend:** App Service (`bidroom-backend-dev` pattern in comments).
- **Frontend:** Static Web Apps with **`APP_CONFIG`** in `index.html` for API + Stripe keys.
- **Redis:** Azure Cache for Redis (`6380` TLS supported in socket adapter options).
- **Storage:** Blob for listing images and claim photos.

See [AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md).

### Environment variables (Backend — non-exhaustive)

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | MongoDB |
| `FRONTEND_URL`, `FRONTEND_URL_PROD`, `CORS_EXTRA_ORIGINS` | CORS / redirects |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Cache + Socket.io adapter |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_IDENTITY_WEBHOOK_SECRET` | Stripe + Identity |
| `FIREBASE_*` / service account | Firebase Admin |
| `AZURE_STORAGE_*` | Blob uploads |
| `AZURE_CONTENT_SAFETY_ENDPOINT`, `AZURE_CONTENT_SAFETY_KEY` | Image moderation (optional) |
| `EMAIL_*` | Nodemailer |
| `ADMIN_EMAILS` | Comma-separated admin emails (required in production for admin routes) |
| `FEATURE_MEMBERSHIP_TIERS` | `true` enables membership tier features server-side |
| `JWT_SECRET` | Present for legacy/helpers if referenced |

---

## Related documentation

- [AUCTION-VS-BEST-OFFER.md](./AUCTION-VS-BEST-OFFER.md)
- [PRIVATE-AUCTION-ROOMS.md](./PRIVATE-AUCTION-ROOMS.md)
- [TRANSACTIONS-AND-DISPUTES.md](./TRANSACTIONS-AND-DISPUTES.md)
- [REVIEW-AND-REPUTATION-SYSTEM.md](./REVIEW-AND-REPUTATION-SYSTEM.md)
- [MEMBERSHIP.md](./MEMBERSHIP.md)
- [HOW_TO_RUN.md](./HOW_TO_RUN.md)
- [AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md)
- [stripe-setup.md](./stripe-setup.md)
