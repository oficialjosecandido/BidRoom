# Review and Reputation System

This document describes how BidRoom implements the review and reputation system to ensure trust, credibility, and accountability across all auctions.

---

## Overview

After each completed transaction, both buyer and seller must publicly rate each other (1–10). Ratings directly impact the **Reputation Score**, which determines access to Private Rooms, exclusive auctions, and premium benefits. The system differentiates between isolated incidents (minor penalty, fast recovery) and recurring patterns (higher penalty).

---

## Functional Requirements

### Post-Transaction Reviews

- **Both parties must rate each other** after a transaction is delivered or completed
- **Score: 1–10** (required)
- **Optional description** (private, never exposed to other users)
- Reviews are allowed when `transactionStatus` is `delivered` or `completed`
- One review per (listing, reviewer, reviewee) – seller reviews buyer once, buyer reviews seller once

### Reputation Score (0–100)

- **Isolated incident**: 1 low review (score ≤ 4) → penalty of 5 points, fast recovery potential
- **Recurring pattern**: 2+ low reviews in last 6 months → penalty of 15 points per low review
- **Dispute loss**: Ruled against in dispute → penalty of 25 points per loss
- **Recovery**: +2 points per successful transaction (capped at +20)
- Recalculated on: new review, dispute ruling, successful transaction completion

### Trust Badges

| Badge | Criteria |
|-------|----------|
| **Verified Funds** | `hasDeposit === true` |
| **Pre-authorized** | `depositAmount >= 100` |
| **Private Room Eligible** | `reputationScore >= 60` AND `disputeLossCount === 0` |

### Fraudulent / Abusive Reviews

Automated detection flags suspicious reviews for admin review:

- **extreme_score**: Score 1 or 10 with no description
- **rapid_submission**: Review submitted within 2 minutes of transaction completion
- **retaliation**: Both parties left low scores (≤ 4) for each other

Flagged reviews are stored in `ReviewFlag` with status `pending`. Admins can resolve as `dismissed` or `confirmed_fake`.

### Dispute Impact on Reputation

When admin issues a dispute ruling:

- **buyer_refund** → seller gets +1 `disputeLossCount`
- **seller_payout** → buyer gets +1 `disputeLossCount` (fraudulent dispute)
- **partial_refund** → both get +1 `disputeLossCount`

Reputation is recalculated for both parties.

### Private Room Eligibility

- Users must have **reputationScore ≥ 60** and **disputeLossCount === 0** to be selected as Platinum Bidders
- Sellers see `reputationScore` and `privateRoomEligible` for each bidder when selecting
- Ineligible bidders are rejected with a clear error message

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reviews/scores/:userId` | Public: buyer/seller review scores |
| GET | `/api/reviews/reputation/:userId` | Public: reputation score, badges, scores |
| GET | `/api/reviews/pending` | Auth: pending reviews for current user |
| POST | `/api/reviews` | Auth: create review (listingId, toUserId, role, score, description?) |
| GET | `/api/auth/customer` | Auth: includes reputationScore, badges, reviewCount |
| GET | `/api/admin/reviews/flagged` | Admin: list flagged reviews |
| PATCH | `/api/admin/reviews/flags/:id` | Admin: resolve flag (status, adminNotes) |

---

## Data Models

### User (reputation fields)

- `reputationScore`: 0–100, default 100
- `disputeLossCount`: count of disputes ruled against
- `successfulTransactionCount`: count of completed transactions with both reviews
- `reputationUpdatedAt`: last recalculation timestamp

### Review

- `listing`, `reviewer`, `reviewee`, `role` (as_buyer | as_seller), `score` (1–10), `description` (optional)

### ReviewFlag

- `review`, `reason` (extreme_score | rapid_submission | retaliation | multiple_low_scores | other)
- `metadata`, `status` (pending | dismissed | confirmed_fake), `resolvedAt`, `resolvedBy`, `adminNotes`

---

## Implementation Files

- `backend/src/models/User.js` – reputation fields
- `backend/src/models/Review.js` – review schema
- `backend/src/models/ReviewFlag.js` – fraud flag schema
- `backend/src/services/reputationService.js` – score calculation, badges, fraud detection
- `backend/src/services/reviewService.js` – score aggregation
- `backend/src/routes/reviews.js` – review API, fraud check, successful tx recording
- `backend/src/routes/admin.js` – dispute verdict impact, flagged reviews
- `backend/src/routes/privateRoom.js` – eligibility enforcement, bidder reputation display
