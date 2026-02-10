# Post-Auction Transaction & Dispute Management

This document describes how BidRoom implements the transaction lifecycle after an auction closes or a Best Offer is accepted, and how disputes are handled.

---

## Overview

When a listing ends with a winner (auction or accepted best offer), the system creates a **Transaction** and both parties move through:

1. **Payment window** (T+0 to T+24h) – seller provides bank details, buyer pays and can upload proof
2. **Shipping** – seller ships within handling days; adds tracking and marks as Sent
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
- Dashboard: Show deadline; seller form for bank details; buyer “Mark as paid” + optional proof upload

---

## Phase 2: Shipping and Handling

**Starts when:** Seller confirms receipt of funds (buyer marked paid) or the 24h payment window has expired.

- **Handling days:** Taken from the listing’s **Handling Time** (e.g. 2 business days). The seller must ship within this period.
- **Dispute freeze:** During the handling period, the buyer **cannot** open a dispute for non-shipment.
- **Seller actions:**
  - Post **tracking number**
  - Select **carrier**
  - Mark transaction status as **Sent** (shipped)
- **Handling deadline:** Stored on the transaction (e.g. `handlingDeadline = paidAt + handlingTime business days`) so the UI can show “Ship by &lt;date&gt;” and enforce dispute-free window.

**Implementation:**

- `Transaction.handlingDeadline` – set when transaction becomes `paid` (or when payment window expires, if we allow that)
- Listing already has `handlingTime` (business days)
- Existing: seller can already add tracking and mark shipped via PATCH
- Frontend: Show “Ship by &lt;handlingDeadline&gt;”; clarify that disputes for non-shipment are not allowed until after this date

---

## Phase 3: Receipt and Verification

**When:** Tracking shows “Delivered” or after a reasonable time.

- **Buyer options:**
  - **Mark as Received Properly** – closes the transaction (`completed`), both parties can leave a **rating**
  - **Mark as Received Improperly** – does **not** close the transaction; opens the **Dispute** flow
- **Transaction status:** `completed` (success) or moves to dispute state (e.g. `dispute_open`).

**Implementation:**

- Buyer already has “Mark as delivered” and “Mark as completed”. We add:
  - **Received Properly** → same as current “Mark as completed” (transaction `completed`, allow reviews)
  - **Received Improperly** → new action: set transaction to `dispute_open`, create a **Dispute** record (Phase 4)
- Optional: “Reasonable timeframe” (e.g. 7 days after “Delivered”) to auto-allow “Mark as completed” if buyer does nothing (configurable).

---

## Phase 4: Dispute Resolution

- **When:** Buyer marks “Received Improperly” (item not as described / not received).
- **Evidence:** The opener (usually buyer) provides:
  - Photo/video evidence
  - Description of the problem
  - Relevant communication (optional)
- **Admin:** All disputes go to the **Bidroom Admin Panel**. A moderator reviews both sides and can:
  - Rule for **Buyer** (return/refund)
  - Rule for **Seller** (dismiss)
  - **Partial refund** (mediated)
- **Data model:** `Dispute` – transaction, openedBy (buyer/seller), reason, evidence (files + text), status (open, resolved_buyer, resolved_seller, partial), admin notes, outcome.

**Implementation:**

- New model: `Dispute` (transaction, openedBy, reason, description, evidenceUrls[], status, resolvedAt, outcome, adminNotes)
- New API: POST dispute (open), GET disputes (admin list), PATCH dispute (admin: set outcome)
- Admin UI: List disputes, view evidence, set outcome
- After outcome: update transaction (e.g. completed / cancelled), trigger reputation impact (Phase 5)

---

## Phase 5: Accountability and Reputation

- **User balance:** Bidroom maintains a **balance/wallet** per user. If an admin rules against a user:
  - **Clawback:** Deduct dispute-related amounts or refund from the user’s platform balance
  - **Card:** Charge the user’s saved payment method if balance is insufficient (when implemented)
  - **Suspension:** Restrict account until the balance is settled (when implemented)
- **Reputation:**
  - **Dispute against seller** (e.g. item not as described) → significant drop in seller rating; optional “Item Not as Described” tag on profile
  - **Fraudulent dispute by buyer** → significant drop in buyer rating; may affect eligibility for Platinum Bidder / private room invitations

**Implementation:**

- Use existing balance/topup and Stripe integration for clawback/charge when needed
- Reputation: extend review/rating or “dispute outcome” history; apply score changes and tags when dispute is resolved

---

## Current Status

| Phase | Description                         | Status |
|-------|-------------------------------------|--------|
| 1     | Payment window, bank details, proof | In progress (schema + API + UI) |
| 2     | Handling deadline, dispute freeze   | Planned (handlingDeadline + UI copy) |
| 3     | Received Properly / Improperly      | Partially done (completed); add “Improperly” → dispute |
| 4     | Dispute model, admin resolution     | Planned |
| 5     | Clawback, reputation impact        | Planned (builds on balance + reviews) |

---

## Security and Privacy

- **Bank details:** Stored only on the transaction and shown only to the buyer for that transaction. Not reused for other listings. Consider masking in logs and admin (e.g. show last 4 digits only).
- **Proof of payment:** Stored as URL (e.g. Azure Blob). Only seller and admin can view.
- **Dispute evidence:** Accessible to the other party and admins only.
