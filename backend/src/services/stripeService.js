const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const BIDROOM_FEE_RATE = 0.02;       // 2% BidRoom fee
const STRIPE_FEE_RATE = 0.029;       // 2.9% Stripe processing fee
const STRIPE_FIXED_FEE = 0.30;       // $0.30 Stripe fixed fee

/**
 * Calculate fee breakdown for a given item price.
 * BidRoom fee (2%) is charged to the buyer on top of the item price.
 * Stripe fee is estimated based on the total charge to buyer.
 */
function calculateFees(itemPrice) {
  const bidRoomFee = parseFloat((itemPrice * BIDROOM_FEE_RATE).toFixed(2));
  const subtotal = itemPrice + bidRoomFee;
  const stripeFee = parseFloat((subtotal * STRIPE_FEE_RATE + STRIPE_FIXED_FEE).toFixed(2));
  const totalChargedToBuyer = parseFloat((subtotal + stripeFee).toFixed(2));
  const sellerPayout = parseFloat((itemPrice - (itemPrice * STRIPE_FEE_RATE + STRIPE_FIXED_FEE)).toFixed(2));

  return {
    itemPrice: parseFloat(itemPrice.toFixed(2)),
    bidRoomFee,
    bidRoomFeeRate: BIDROOM_FEE_RATE,
    stripeFee,
    stripeFeeRate: STRIPE_FEE_RATE,
    stripeFixedFee: STRIPE_FIXED_FEE,
    totalChargedToBuyer,
    sellerPayout,
    // Stripe requires amounts in cents (integer)
    stripeAmountInCents: Math.round(totalChargedToBuyer * 100),
    applicationFeeInCents: Math.round(bidRoomFee * 100)
  };
}

/**
 * Create a Stripe Express Connected Account for a seller.
 * Returns the account object.
 */
async function createConnectedAccount(email, firstName, lastName) {
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    business_type: 'individual',
    individual: {
      first_name: firstName,
      last_name: lastName,
      email
    },
    metadata: {
      platform: 'BidRoom',
      environment: process.env.NODE_ENV || 'development'
    }
  });
  return account;
}

/**
 * Generate an account onboarding link for Stripe Connect.
 */
async function createAccountLink(accountId, refreshUrl, returnUrl) {
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding'
  });
  return accountLink;
}

/**
 * Retrieve a connected account's details.
 */
async function getConnectedAccount(accountId) {
  return await stripe.accounts.retrieve(accountId);
}

/**
 * Create a Payment Intent for a buyer to pay for a won auction.
 * Uses Stripe Connect with application fee for BidRoom's 2% cut.
 *
 * @param {number} itemPrice - The winning bid amount (in dollars)
 * @param {string} sellerStripeAccountId - The seller's Stripe connected account ID
 * @param {object} metadata - Additional metadata for the payment intent
 */
async function createPaymentIntent(itemPrice, sellerStripeAccountId, metadata = {}) {
  const fees = calculateFees(itemPrice);

  const paymentIntentParams = {
    amount: fees.stripeAmountInCents,
    currency: 'usd',
    application_fee_amount: fees.applicationFeeInCents,
    metadata: {
      ...metadata,
      bidRoomFee: fees.bidRoomFee.toString(),
      bidRoomFeeRate: fees.bidRoomFeeRate.toString(),
      stripeFeeEstimate: fees.stripeFee.toString(),
      itemPrice: fees.itemPrice.toString(),
      environment: process.env.NODE_ENV || 'development'
    },
    automatic_payment_methods: {
      enabled: true
    }
  };

  // Only add transfer_data if seller has a connected account
  if (sellerStripeAccountId) {
    paymentIntentParams.transfer_data = {
      destination: sellerStripeAccountId
    };
  }

  const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

  return {
    paymentIntent,
    fees,
    clientSecret: paymentIntent.client_secret
  };
}

/**
 * Retrieve a Payment Intent by ID.
 */
async function getPaymentIntent(paymentIntentId) {
  return await stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Confirm a payment intent (server-side confirmation if needed).
 */
async function confirmPaymentIntent(paymentIntentId) {
  return await stripe.paymentIntents.confirm(paymentIntentId);
}

/**
 * Construct a Stripe webhook event from raw body and signature.
 */
function constructWebhookEvent(rawBody, signature, webhookSecret) {
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * List payouts for a connected account.
 */
async function getConnectedAccountBalance(accountId) {
  return await stripe.balance.retrieve({ stripeAccount: accountId });
}

module.exports = {
  stripe,
  calculateFees,
  createConnectedAccount,
  createAccountLink,
  getConnectedAccount,
  createPaymentIntent,
  getPaymentIntent,
  confirmPaymentIntent,
  constructWebhookEvent,
  getConnectedAccountBalance
};
