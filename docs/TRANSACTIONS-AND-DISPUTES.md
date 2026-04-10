# Post-Auction Transaction & Dispute Management

This document describes how BidRoom implements the transaction lifecycle after an auction closes or a Best Offer is accepted, and how disputes are handled.

---

## Overview

When a listing ends with a winner (auction or accepted best offer), the system creates a **Transaction** and both parties move through:

1. **Payment window** (T+0 to T+24h) – seller provides bank details, buyer pays and can upload proof
2. **Shipping deadline enforcement** – seller must ship within **5 business days** of payment; midpoint warning on day 3; auto-cancel + full Stripe refund on day 5
3. **Receipt** – buyer marks Received Properly (complete) or Received Improperly (dispute)
4. **Disputes** – evidence, admin review, outcome (buyer/seller/partial), reputation impact

---

## Phase 1: Payment Window (T+0 to T+24h)

**Transaction status:** `pending_payment`

- **Payment deadline:** Set automatically when the transaction is created (T+24 hours). Shown to both parties.
- **Seller:** Must provide **bank details** (IBAN, SWIFT, account name) via the transaction page within 24h so the buyer can make the transfer. Stored securely per transaction.
- **Buyer:** Must complete payment by **bank transfer** (outside the platform) within 24h. Then:
  - Marks the item as **Paid**
  - Can optionally **upload a receipt/screenshot** (proof of payment) to notify the seller
- **After 24h:** The payment window is considered closed. Seller can still add bank details late; buyer can still mark paid. Phase 2 (shipping) can start once the seller confirms funds or the window has passed (handling deadline is calculated from then).

**Implementation:**

- `Transaction.paymentDeadline` – date/time (T+24h at creation)
- `Transaction.sellerBankIban`, `sellerBankSwift`, `sellerBankAccountName` – seller fills these on the transaction page
- `Transaction.buyerProofOfPaymentUrl` – optional URL (e.g. uploaded image) when buyer marks paid
- API: PATCH transaction allows seller to set bank details; buyer to set proof URL when marking paid
- Dashboard: Show deadline; seller form for bank details; buyer "Mark as paid" + optional proof upload

---

## Phase 2: Shipping Deadline Enforcement (5 Business Days)

**Starts when:** Buyer payment is confirmed via Stripe Connect (either the `/api/connect/confirm-payment` endpoint or the `checkout.session.completed` webhook). At the moment of payment confirmation, `Transaction.paidAt` is set and the 5-business-day shipping deadline is computed.

### Timeline

| Business Day | Event |
|:---:|---|
| **Day 1–3** | Seller should ship the order. Both parties see the deadline in the dashboard. |
| **End of Day 3** | **Midpoint warning** — if the item has not been shipped, the scheduler sends the seller an in-app notification + email: *"You have 2 business days left to ship or the order will be cancelled."* Recorded in `shippingMidpointWarningSentAt` (sent once). |
| **Day 4–5** | Seller has 2 remaining business days to ship. |
| **End of Day 5** | **Auto-cancellation** — if the item is still not shipped: a full Stripe refund is issued to the buyer, the transaction is cancelled, and both parties are notified via in-app + email. Recorded in `shippingAutoCancelledAt`. |

> **Business days** = Monday–Friday in UTC. Weekends are skipped. Example: a payment confirmed on Friday gives the seller until the end of the following Friday (5 weekdays). See `backend/src/services/businessDays.js`.

### Seller Actions

- View the "Ship this order by" deadline in the transaction card
- Post **tracking number** and select **carrier**
- Optionally upload **proof of delivery** (shipping receipt)
- Mark transaction as **Shipped** (only allowed when `transactionStatus` is `paid`)

### Buyer Visibility

- **Shipping status**: "Not shipped" or "Shipped — [carrier] [tracking]"
- **Expected ship-by** deadline (5 business days)
- **"Remind seller to ship"** button — sends a push notification to the seller. Rate-limited: once per 24 hours per transaction (`429` with `retryAfterMs` if the cooldown hasn't elapsed).

### Scheduler (`shippingDeadlineScheduler`)

Runs every **15 minutes** (configured in `backend/src/index.js`). Each run executes two checks in parallel:

1. **`processMidpointWarnings`** — finds paid/awaiting transactions past the 3-business-day threshold where no warning has been sent and `sendingStatus` is still `pending`. Sends in-app + email notification, marks the warning as sent.
2. **`processAutoCancellations`** — finds similar transactions past the 5-business-day deadline. Issues a Stripe refund (with `reverse_transfer` + `refund_application_fee`; falls back to a plain refund if those flags aren't applicable). Sets `transactionStatus` to `cancelled` and notifies both parties.

### Data Model

| Field | Type | Purpose |
|-------|------|---------|
| `shipByBusinessDeadline` | Date | End of 5th business day — auto-cancel threshold |
| `shippingMidpointWarningSentAt` | Date | When the day-3 warning was sent (idempotency guard) |
| `buyerRemindSellerShipAt` | Date | Last buyer reminder timestamp (24h cooldown) |
| `shippingAutoCancelledAt` | Date | When auto-cancel + refund occurred |
| `handlingDeadline` | Date | Legacy field; mirrors `shipByBusinessDeadline` |

### Key Backend Files

| File | Responsibility |
|------|---------------|
| `services/businessDays.js` | UTC business-day calculation (Mon–Fri, skip weekends) |
| `services/shippingDeadlines.js` | Constants (`SHIP_BUSINESS_DAYS=5`, `MIDPOINT_BUSINESS_DAYS=3`) + helpers to apply/resolve deadlines |
| `services/shippingDeadlineScheduler.js` | Periodic checks: midpoint warning + auto-cancel + Stripe refund |
| `routes/connect.js` | Sets deadlines at payment confirmation |
| `routes/transactions.js` | `POST /:id/remind-ship` endpoint + shipped status validation |
| `services/notificationService.js` | Notification functions for warnings, reminders, and cancellations |

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/transactions/:id/remind-ship` | Buyer | Nudge seller to ship (24h cooldown) |
| `PATCH` | `/api/transactions/:id` | Seller | Mark as shipped (status must be `paid`) |

### Frontend

- **Seller card**: shows "Ship this order by: &lt;date&gt;" when status is `awaiting_seller_acceptance` or `paid`
- **Buyer card**: shows shipping status, expected ship-by date, and "Remind seller to ship" button with cooldown hint
- **i18n keys**: `shippingStatusLabel`, `expectedShipBy`, `sellerMustShipBy`, `remindSellerToShip`, `remindingSeller`, `remindSellerCooldown`

---

## Phase 3: Receipt and Verification

**When:** Tracking shows "Delivered" or after a reasonable time.

- **Buyer options:**
  - **Mark as Received Properly** – closes the transaction (`completed`), both parties can leave a **rating**
  - **Mark as Received Improperly** – does **not** close the transaction; opens the **Dispute** flow
- **Transaction status:** `completed` (success) or moves to dispute state (e.g. `dispute_open`).

**Implementation:**

- Buyer already has "Mark as delivered" and "Mark as completed". We add:
  - **Received Properly** → same as current "Mark as completed" (transaction `completed`, allow reviews)
  - **Received Improperly** → new action: set transaction to `dispute_open`, create a **Dispute** record (Phase 4)
- Optional: "Reasonable timeframe" (e.g. 7 days after "Delivered") to auto-allow "Mark as completed" if buyer does nothing (configurable).

---

## Phase 4: Dispute Resolution

- **When:** Buyer marks "Received Improperly" (item not as described / not received).
- **Evidence:** The opener (usually buyer) provides:
  - Photo/video evidence
  - Description of the problem
  - Relevant communication (optional)
- **Admin:** All disputes go to the **Bidroom Admin Panel**. A moderator reviews both sides and can:
  - Rule for **Buyer** (return/refund)
  - Rule for **Seller** (dismiss)
  - **Partial refund** (mediated)
- **Account suspension:** When a dispute is formally opened, both buyer and seller accounts are automatically set to **Suspended**. Suspended accounts cannot create listings, place bids, or complete transactions. When the admin issues a ruling, they must also choose an **account outcome**: reactivate both, reactivate one and permanently close the other, or close both. All status changes are logged and users are notified.
- **Data model:** `Dispute` – transaction, openedBy (buyer/seller), reason, evidence (files + text), status (open, resolved_buyer, resolved_seller, partial), admin notes, outcome.

### Account Suspension During Disputes

When a dispute is formally opened, **both buyer and seller accounts are automatically suspended**:

- **User.accountStatus** is set to `suspended` for both parties
- Suspended accounts **cannot**: create listings, place bids, submit offers, complete payments, or update transaction status
- All status changes are logged in **AccountStatusAuditLog** (userId, previousStatus, newStatus, reason, transactionId, metadata)
- Users receive in-app notifications when their account status changes

**Admin ruling – account outcome:** When issuing a dispute ruling, the admin must also choose an **accountOutcome**:

| Outcome | Buyer | Seller |
|--------|-------|--------|
| `reactivate_both` | active | active |
| `reactivate_buyer_close_seller` | active | closed |
| `reactivate_seller_close_buyer` | closed | active |
| `close_both` | closed | closed |

- **Closed** accounts are permanently disabled
- **Reactivated** accounts return to normal use
- Each change is audited and the user is notified

**Implementation:**

- New model: `Dispute` (transaction, openedBy, reason, description, evidenceUrls[], status, resolvedAt, outcome, adminNotes)
- New API: POST dispute (open), GET disputes (admin list), PATCH dispute (admin: set outcome)
- Admin UI: List disputes, view evidence, set outcome
- After outcome: update transaction (e.g. completed / cancelled), trigger reputation impact (Phase 5)

---

## Account Suspension on Dispute

When a dispute is formally opened, both the buyer and seller accounts are **automatically suspended**:

- **User.accountStatus** is set to `suspended` for both parties
- **AccountStatusAuditLog** records each status change (reason: `dispute_opened`, transactionId, timestamps)
- **Notifications** are sent to both users informing them of the suspension

**Suspended accounts cannot:**
- Create listings
- Place bids or offers
- Complete transactions (payment, shipping updates)
- Upload listing images
- Select Platinum Bidders for private rooms

**Admin ruling – account outcome**

When issuing a dispute ruling, the admin must also choose an **accountOutcome** (body parameter):

| Outcome | Buyer | Seller |
|---------|-------|--------|
| `reactivate_both` | active | active |
| `reactivate_buyer_close_seller` | active | closed |
| `reactivate_seller_close_buyer` | closed | active |
| `close_both` | closed | closed |

For each status change: the user is updated, an audit log entry is created, and the user is notified. All changes are logged for audit purposes.

**Implementation:**
- `User.accountStatus`: `active` | `suspended` | `closed`
- `AccountStatusAuditLog` model: user, previousStatus, newStatus, reason, transactionId, metadata, timestamps
- `accountStatusService`: `suspendBothPartiesForDispute`, `applyDisputeAccountOutcome`
- `requireActiveAccount` middleware applied to listings, bids, offers, payments, transactions PATCH, uploads, platinum-bidders
- `GET /api/auth/customer` returns `accountStatus` for frontend display

---

## Phase 5: Accountability and Reputation

- **User balance:** Bidroom maintains a **balance/wallet** per user. If an admin rules against a user:
  - **Clawback:** Deduct dispute-related amounts or refund from the user's platform balance
  - **Card:** Charge the user's saved payment method if balance is insufficient (when implemented)
  - **Suspension:** Restrict account until the balance is settled (when implemented)
- **Reputation:**
  - **Dispute against seller** (e.g. item not as described) → significant drop in seller rating; optional "Item Not as Described" tag on profile
  - **Fraudulent dispute by buyer** → significant drop in buyer rating; may affect eligibility for Platinum Bidder / private room invitations

**Implementation:**

- Use existing balance/topup and Stripe integration for clawback/charge when needed
- Reputation: extend review/rating or "dispute outcome" history; apply score changes and tags when dispute is resolved

---

## Current Status

| Phase | Description                         | Status |
|-------|-------------------------------------|--------|
| 1     | Payment window, bank details, proof | Implemented (Stripe Connect checkout) |
| 2     | Shipping deadline enforcement (5 business days), midpoint warning, auto-cancel + refund, buyer reminder | **Implemented** |
| 3     | Received Properly / Improperly      | Partially done (completed); add "Improperly" → dispute |
| 4     | Dispute model, admin resolution, account suspension | Implemented |
| 5     | Clawback, reputation impact        | Planned (builds on balance + reviews) |

---

## Security and Privacy

- **Bank details:** Stored only on the transaction and shown only to the buyer for that transaction. Not reused for other listings. Consider masking in logs and admin (e.g. show last 4 digits only).
- **Proof of payment:** Stored as URL (e.g. Azure Blob). Only seller and admin can view.
- **Dispute evidence:** Accessible to the other party and admins only.
- **Stripe refunds:** Auto-cancel refunds use `reverse_transfer` + `refund_application_fee` to fully claw back both the seller payout and the platform fee. The Stripe refund ID is stored in `Transaction.stripeRefundId` for audit.
