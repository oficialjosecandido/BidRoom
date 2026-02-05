# How Membership Works

This document explains how membership and balance work in BidRoom: tiers, top-ups, and how they relate to auctions and offers.

---

## Overview

- **Membership** in BidRoom is tied to your **account balance**. There are no separate subscription plans; you add funds to your balance, and that balance is used to participate in auctions and offers.
- **Tiers** (Bronze, Silver, Gold, Platinum) are **suggested top-up amounts** only. They help you add a set amount in one go; your “tier” is effectively reflected by how much you have in your balance.
- **Platinum Bidders** (private room) are a **separate concept**: they are bidders invited by the seller to a specific listing’s private auction room, and are not the same as the “Platinum” membership tier amount.

---

## Balance

- Each customer has a **balance** (in USD) stored in the `customers` collection.
- Balance is shown on the **Dashboard** and can be increased via **“Increase balance”**.
- Balance is intended to be used when participating in **auctions** and **offers** (e.g. to place bids or secure offers). The exact deduction rules depend on your business logic in the bid/offer flows.

---

## Membership Tiers (Top-up Presets)

The app suggests four preset amounts when adding funds:

| Tier      | Suggested amount |
|----------|-------------------|
| Bronze   | $10               |
| Silver   | $25               |
| Gold     | $100              |
| Platinum | $1,000            |

- These are **only presets**. You can choose a tier or enter a **custom amount** (minimum $5, up to the configured maximum).
- Choosing a tier or custom amount does **not** change your “membership type”; it only sets how much you add in that single top-up.

---

## Adding Funds (Top-up Flow)

1. **Dashboard** → **“Increase balance”** opens a modal.
2. User selects a tier (e.g. Silver $25) or **Custom amount** (min $5).
3. User clicks **“Continue to payment”** → backend creates a **Stripe Checkout Session** and returns the session URL.
4. User is redirected to **Stripe Checkout** to pay by card.
5. After payment:
   - Stripe redirects back to:  
     ` /dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`
   - Frontend calls **`POST /api/payments/confirm-session`** with that `session_id`.
   - Backend:
     - Verifies the session with Stripe and that it is **paid**.
     - Credits the customer’s **balance** (idempotent: same session is never credited twice).
     - Creates a **top-up record** in the `topups` collection.
     - Sends a **payment confirmation email** (if email is configured).
   - User sees a success message and the dashboard balance and **Top-up history** are updated.

A **Stripe webhook** (`checkout.session.completed`) is also configured so that if the user closes the browser before the redirect, the backend can still credit the balance when Stripe notifies it.

---

## Top-up History

- Every successful Stripe payment that credits the balance is stored as a **top-up** in the `topups` collection (fields such as: customer `uid`, `amount`, `currency`, `stripeSessionId`, `createdAt`).
- Customers can see their **Top-up history** on the **Dashboard** (table with date and amount).
- API: **`GET /api/payments/topups`** (authenticated) returns the current user’s top-ups, most recent first.

---

## Technical Summary

| Item              | Location / API |
|-------------------|----------------|
| Customer balance  | `customers.balance` (backend); Dashboard (frontend) |
| Top-up records    | `topups` collection; created when balance is credited |
| Create checkout   | `POST /api/payments/create-checkout-session` body: `{ amountDollars }` |
| Confirm payment   | `POST /api/payments/confirm-session` body: `{ session_id }` |
| Top-up history    | `GET /api/payments/topups` |
| Webhook           | `POST /api/payments/webhook` (Stripe `checkout.session.completed`) |

Idempotency is enforced by storing **Stripe Checkout Session IDs** that have already been credited on the customer document (`creditedStripeSessionIds`), so the same payment is never applied twice whether confirmation comes from the redirect or the webhook.

---

## Platinum Bidders (Private Room) – Different Concept

- **Platinum Bidders** are bidders **invited by the seller** to a specific listing’s **private auction room** (up to 5 per listing).
- Only those invited bidders can place bids in that listing’s private room.
- This is **not** the same as the “Platinum” membership tier ($1,000 top-up). The word “Platinum” is used in two different ways: one for a top-up preset, one for invited private-room bidders.

For details on private rooms and Platinum Bidders, see the code and docs for listings, private room, and admin/seller flows.
