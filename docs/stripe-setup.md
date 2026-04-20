# Stripe Setup Guide

## Overview

BidRoom uses two Stripe products:
- **Stripe Connect** (Custom accounts) — sellers connect payout accounts so they can receive payments
- **Stripe Checkout / Payment Intents** — buyers pay for won auctions

Each backend environment (dev, prod) needs its own Stripe keys configured.

---

## 1. Enable Stripe Connect (required before any seller can onboard)

This is a one-time step per Stripe account (test and live separately).

### Test mode (DEV environment)

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Toggle **Test mode** on (top-right corner — button turns orange)
3. Go to **Settings → Connect settings** (search "Connect" in the nav if not visible)
4. Under **Platform profile**, fill in:
   - Platform name: `BidRoom`
   - Business type: `Company`
   - Website URL: your Azure dev URL (e.g. `https://icy-glacier-05c442c0f.3.azurestaticapps.net`)
5. Under **Account types**, enable **Custom accounts**
6. Click **Save**

> Without this step the backend throws `StripePermissionError` when any seller tries to set up their payout account.

### Live mode (PROD environment)

Repeat the same steps after switching **Test mode off**. Use the production frontend URL for the website field.

---

## 2. Create / locate your API keys

### Test keys (for DEV backend)

1. Test mode on → **Developers → API keys**
2. Copy **Publishable key** (`pk_test_...`) and **Secret key** (`sk_test_...`)

### Live keys (for PROD backend)

1. Test mode off → **Developers → API keys**
2. Copy **Publishable key** (`pk_live_...`) and **Secret key** (`sk_live_...`)

---

## 3. Set up Webhooks

Webhooks notify the backend when Stripe events occur (payment confirmed, payout sent, etc.).

### For DEV (local or Azure dev)

1. Go to **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://<your-dev-backend>.azurewebsites.net/api/payments/webhook`
3. Select events:
   - `checkout.session.completed` (triggers payment confirmation + shipping deadline start)
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
4. Copy the **Signing secret** (`whsec_...`) → set as `STRIPE_WEBHOOK_SECRET` in your backend env

Repeat for the Connect webhook:
- Endpoint URL: `https://<your-dev-backend>.azurewebsites.net/api/connect/webhook`
- Events: `account.updated`
- Copy signing secret → set as `STRIPE_CONNECT_WEBHOOK_SECRET`

### For PROD

Same steps using your production backend URL and live mode enabled.

---

## 4. Environment variables

Set these in Azure App Service Configuration (or your `.env` for local dev):

| Variable | DEV value | PROD value |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (test) | `whsec_...` (live) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_...` (test) | `whsec_...` (live) |

The frontend Stripe publishable key is injected at runtime via `window.APP_CONFIG.STRIPE_PUBLISHABLE_KEY` in `index.html`. Set this per environment in your CI/CD pipeline:

| Environment | Value |
|---|---|
| DEV | `pk_test_...` |
| PROD | `pk_live_...` |

---

## 5. Verify a seller account in DEV (test mode only)

QA testers can verify their payout account instantly without going through real Stripe verification:

1. Log in as the seller account on the DEV environment
2. Go to **Dashboard → Settings → Payments**
3. Click **"Set up payout account"**
4. Fill in the form with these magic test values:
   - **Date of birth:** `01 / 01 / 1901`
   - **ID number:** `000000000`
   - **Street address:** anything (e.g. `123 Test Street`)
   - **City:** anything (e.g. `Lisbon`)
   - **Postal code:** anything (e.g. `1750-001`)
   - **Country:** Portugal (or any supported country)
   - **IBAN:** a valid test IBAN — e.g. `PT50 0002 0123 1234 5678 9015 4` (Portugal)
   - Check the authorisation checkbox
5. Click **Save payout account**
6. Once saved, click **⚡ Simulate verification** — this button is only visible in test mode and instantly marks the account as verified

The **⚡ Simulate verification** button will not appear in production (it is hidden when `STRIPE_SECRET_KEY` starts with `sk_live_`).

---

## 6. Automatic Refunds (Shipping Deadline Enforcement)

The shipping deadline scheduler (`shippingDeadlineScheduler.js`) issues automatic Stripe refunds when a seller fails to ship within 5 business days.

### How it works

1. The scheduler first attempts a refund with `reverse_transfer: true` and `refund_application_fee: true`. This claws back the seller's payout portion and returns the BidRoom platform fee.
2. If that fails (e.g. no transfer was created yet, or the connected account has insufficient balance), it falls back to a plain `stripe.refunds.create({ payment_intent })`.
3. The refund ID is stored in `Transaction.stripeRefundId` for audit.

### Requirements

- `STRIPE_SECRET_KEY` must be set (the scheduler skips refunds if Stripe isn't configured).
- The `payment_intent` on the transaction must be a valid, captured Stripe PaymentIntent.
- For `reverse_transfer` to work, the PaymentIntent must have an associated Transfer to a connected account.

### Monitoring refunds

- Check the Stripe Dashboard → **Payments → Refunds** for refund status.
- Backend logs lines like `[ShippingDeadline] Auto-cancelled tx=<id> refund=<refundId>` on success, or `[ShippingDeadline] Refund failed tx=<id>: <error>` on failure.
- Failed refunds do **not** cancel the transaction — the scheduler will retry on the next run since the transaction still matches the query criteria.

---

## 7. Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Payout account setup is temporarily unavailable` | Stripe Connect not enabled on the platform account | Follow step 1 above |
| `Payments not configured` | `STRIPE_SECRET_KEY` missing from backend env | Add the env var in Azure App Service Configuration |
| Webhook events not received | Wrong endpoint URL or signing secret | Verify the endpoint URL and re-copy the signing secret |
| `StripeInvalidRequestError` on IBAN | IBAN format invalid or unsupported country | Use a valid IBAN for a supported country |
| Live key used in DEV | `STRIPE_SECRET_KEY` set to `sk_live_` in dev env | Replace with `sk_test_` key |
