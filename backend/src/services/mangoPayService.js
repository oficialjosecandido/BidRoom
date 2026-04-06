/**
 * MangoPay Service
 * Wraps all MangoPay API calls used by BidRoom.
 *
 * Environment variables required:
 *   MANGOPAY_CLIENT_ID   — your MangoPay Client ID
 *   MANGOPAY_API_KEY     — your MangoPay API Key (sandbox or production)
 *   MANGOPAY_BASE_URL    — https://api.sandbox.mangopay.com (sandbox) OR https://api.mangopay.com (production)
 *
 * Each seller gets:
 *   • One NaturalUser (mangoPayUserId on User model)
 *   • One Wallet       (mangoPayWalletId on User model)
 *   • One BankAccount  (mangoPayBankAccountId on User model — IBAN)
 *
 * The platform itself has one pre-created Wallet in MangoPay (MANGOPAY_PLATFORM_WALLET_ID)
 * that receives the 2% commission on each sale.
 */

const Mangopay = require('mangopay2-nodejs-sdk');

const LOG = '[MangoPay]';

let _api = null;

function getApi() {
  if (_api) return _api;
  const clientId = process.env.MANGOPAY_CLIENT_ID;
  const apiKey = process.env.MANGOPAY_API_KEY;
  if (!clientId || !apiKey) {
    throw new Error('MANGOPAY_CLIENT_ID and MANGOPAY_API_KEY environment variables are required');
  }
  _api = new Mangopay({
    clientId,
    clientApiKey: apiKey,
    baseUrl: process.env.MANGOPAY_BASE_URL || 'https://api.sandbox.mangopay.com',
    debugMode: process.env.NODE_ENV !== 'production'
  });
  return _api;
}

// ─── Users ────────────────────────────────────────────────────────────────────

/**
 * Create a MangoPay NaturalUser for a BidRoom seller.
 * @param {{ firstName, lastName, email, dobDay, dobMonth, dobYear, addressLine1, addressCity, addressPostal, addressCountry }} data
 * @returns {Promise<string>} mangoPayUserId
 */
async function createNaturalUser(data) {
  const api = getApi();
  const { firstName, lastName, email, dobDay, dobMonth, dobYear, addressLine1, addressCity, addressPostal, addressCountry } = data;

  const birthdayTimestamp = Math.floor(new Date(dobYear, dobMonth - 1, dobDay).getTime() / 1000);

  const user = new api.models.UserNatural();
  user.FirstName = firstName;
  user.LastName = lastName;
  user.Email = email;
  user.Birthday = birthdayTimestamp;
  user.Nationality = addressCountry;
  user.CountryOfResidence = addressCountry;
  user.Address = {
    AddressLine1: addressLine1,
    City: addressCity,
    PostalCode: addressPostal,
    Country: addressCountry
  };

  const created = await api.Users.create(user);
  console.log(`${LOG} Created NaturalUser Id=${created.Id} for ${email}`);
  return created.Id;
}

/**
 * Update an existing MangoPay NaturalUser (e.g. when seller updates their details).
 */
async function updateNaturalUser(mangoPayUserId, data) {
  const api = getApi();
  const { firstName, lastName, dobDay, dobMonth, dobYear, addressLine1, addressCity, addressPostal, addressCountry } = data;

  const birthdayTimestamp = Math.floor(new Date(dobYear, dobMonth - 1, dobDay).getTime() / 1000);

  const user = new api.models.UserNatural();
  user.Id = mangoPayUserId;
  user.FirstName = firstName;
  user.LastName = lastName;
  user.Birthday = birthdayTimestamp;
  user.Nationality = addressCountry;
  user.CountryOfResidence = addressCountry;
  user.Address = {
    AddressLine1: addressLine1,
    City: addressCity,
    PostalCode: addressPostal,
    Country: addressCountry
  };

  const updated = await api.Users.update(user);
  console.log(`${LOG} Updated NaturalUser Id=${mangoPayUserId}`);
  return updated;
}

/**
 * Get a MangoPay user by ID.
 */
async function getUser(mangoPayUserId) {
  const api = getApi();
  return api.Users.get(mangoPayUserId);
}

// ─── Wallets ──────────────────────────────────────────────────────────────────

/**
 * Create a EUR wallet for a seller.
 * @param {string} mangoPayUserId
 * @param {string} currency — ISO 4217 code, defaults to 'EUR'
 * @returns {Promise<string>} mangoPayWalletId
 */
async function createWallet(mangoPayUserId, currency = 'EUR') {
  const api = getApi();

  const wallet = new api.models.Wallet();
  wallet.Owners = [mangoPayUserId];
  wallet.Description = 'BidRoom Seller Wallet';
  wallet.Currency = currency;

  const created = await api.Wallets.create(wallet);
  console.log(`${LOG} Created Wallet Id=${created.Id} for UserId=${mangoPayUserId}`);
  return created.Id;
}

/**
 * Get wallet balance (in cents).
 */
async function getWallet(walletId) {
  const api = getApi();
  return api.Wallets.get(walletId);
}

// ─── Bank Accounts ────────────────────────────────────────────────────────────

/**
 * Add or replace an IBAN bank account for a seller.
 * @param {string} mangoPayUserId
 * @param {{ ownerName, iban, bic, addressLine1, addressCity, addressPostal, addressCountry }} data
 * @returns {Promise<string>} mangoPayBankAccountId
 */
async function createIbanBankAccount(mangoPayUserId, data) {
  const api = getApi();
  const { ownerName, iban, bic, addressLine1, addressCity, addressPostal, addressCountry } = data;

  const bankAccount = new api.models.BankAccountIban();
  bankAccount.OwnerName = ownerName;
  bankAccount.IBAN = iban.replace(/\s+/g, '').toUpperCase();
  if (bic) bankAccount.BIC = bic.replace(/\s+/g, '').toUpperCase();
  bankAccount.OwnerAddress = {
    AddressLine1: addressLine1,
    City: addressCity,
    PostalCode: addressPostal,
    Country: addressCountry
  };

  const created = await api.Users.createBankAccount(mangoPayUserId, bankAccount);
  console.log(`${LOG} Created BankAccount Id=${created.Id} for UserId=${mangoPayUserId}`);
  return created.Id;
}

/**
 * Deactivate a bank account (required before adding a new one).
 */
async function deactivateBankAccount(mangoPayUserId, bankAccountId) {
  const api = getApi();
  const bankAccount = new api.models.BankAccount();
  bankAccount.Id = bankAccountId;
  bankAccount.Active = false;
  await api.Users.updateBankAccount(mangoPayUserId, bankAccount, bankAccountId);
  console.log(`${LOG} Deactivated BankAccount Id=${bankAccountId}`);
}

// ─── Card Registration (Buyer Side) ──────────────────────────────────────────

/**
 * Create a CardRegistration object — returned to the frontend so MangoPay.js
 * can tokenize the card directly (PCI compliant, card data never touches our server).
 * @param {string} mangoPayUserId — buyer's MangoPay user ID (create one lazily if none)
 * @param {string} currency
 * @returns {Promise<object>} CardRegistration object (Id, AccessKey, PreregistrationData, CardRegistrationURL)
 */
async function createCardRegistration(mangoPayUserId, currency = 'EUR') {
  const api = getApi();

  const cardReg = new api.models.CardRegistration();
  cardReg.UserId = mangoPayUserId;
  cardReg.Currency = currency;
  cardReg.CardType = 'CB_VISA_MASTERCARD';

  const created = await api.CardRegistrations.create(cardReg);
  console.log(`${LOG} Created CardRegistration Id=${created.Id} for UserId=${mangoPayUserId}`);
  return created;
}

/**
 * Finalize card registration after MangoPay.js returns the RegistrationData token.
 * @param {string} cardRegistrationId
 * @param {string} registrationData — token returned by MangoPay.js
 * @returns {Promise<string>} CardId to use for PayIns
 */
async function finalizeCardRegistration(cardRegistrationId, registrationData) {
  const api = getApi();

  const cardReg = new api.models.CardRegistration();
  cardReg.Id = cardRegistrationId;
  cardReg.RegistrationData = registrationData;

  const updated = await api.CardRegistrations.update(cardReg);
  console.log(`${LOG} Finalized CardRegistration Id=${cardRegistrationId} → CardId=${updated.CardId}`);
  return updated.CardId;
}

// ─── PayIns ───────────────────────────────────────────────────────────────────

/**
 * Create a Card Direct PayIn — money moves from buyer card → seller wallet (escrow).
 * Uses 3DS (SecureMode=FORCE) for SCA compliance.
 *
 * @param {{
 *   buyerMangoPayUserId: string,
 *   sellerWalletId: string,
 *   cardId: string,
 *   amountCents: number,
 *   feeCents: number,        — platform commission (deducted from the PayIn)
 *   currency: string,
 *   transactionId: string,   — our DB transaction ID (stored in Tag for reconciliation)
 *   returnUrl: string,       — where MangoPay redirects after 3DS
 *   idempotencyKey: string
 * }} data
 * @returns {Promise<object>} PayIn object
 */
async function createDirectCardPayIn(data) {
  const api = getApi();
  const { buyerMangoPayUserId, sellerWalletId, cardId, amountCents, feeCents, currency, transactionId, returnUrl, idempotencyKey } = data;

  const payIn = new api.models.PayInCardDirect();
  payIn.AuthorId = buyerMangoPayUserId;
  payIn.CreditedWalletId = sellerWalletId;
  payIn.CardId = cardId;
  payIn.Tag = `bidroom-transaction:${transactionId}`;

  payIn.DebitedFunds = new api.models.Money();
  payIn.DebitedFunds.Currency = currency;
  payIn.DebitedFunds.Amount = amountCents; // total charged to buyer

  payIn.Fees = new api.models.Money();
  payIn.Fees.Currency = currency;
  payIn.Fees.Amount = feeCents; // BidRoom commission (2%) — credited to platform

  payIn.CreditedFunds = new api.models.Money();
  payIn.CreditedFunds.Currency = currency;
  payIn.CreditedFunds.Amount = amountCents - feeCents;

  // SCA — redirect buyer to MangoPay 3DS page before payment completes
  payIn.SecureMode = 'FORCE';
  payIn.SecureModeReturnURL = returnUrl;

  const created = await api.PayIns.create(payIn, idempotencyKey);
  console.log(`${LOG} Created PayIn Id=${created.Id} Status=${created.Status} txn=${transactionId}`);
  return created;
}

/**
 * Get a PayIn by ID (used by webhook handler to get final status).
 */
async function getPayIn(payInId) {
  const api = getApi();
  return api.PayIns.get(payInId);
}

// ─── Transfers (Escrow → Platform commission) ─────────────────────────────────

/**
 * Transfer the platform commission from seller's wallet to the platform wallet.
 * Called when releasing escrow (after 48h inspection window).
 *
 * @param {{
 *   sellerMangoPayUserId: string,
 *   sellerWalletId: string,
 *   platformWalletId: string,
 *   commissionCents: number,
 *   currency: string,
 *   transactionId: string
 * }} data
 * @returns {Promise<object>} Transfer object
 */
async function createTransfer(data) {
  const api = getApi();
  const { sellerMangoPayUserId, sellerWalletId, platformWalletId, commissionCents, currency, transactionId } = data;

  const transfer = new api.models.Transfer();
  transfer.AuthorId = sellerMangoPayUserId;
  transfer.CreditedUserId = process.env.MANGOPAY_PLATFORM_USER_ID;
  transfer.DebitedWalletId = sellerWalletId;
  transfer.CreditedWalletId = platformWalletId;
  transfer.Tag = `bidroom-commission:${transactionId}`;

  transfer.DebitedFunds = new api.models.Money();
  transfer.DebitedFunds.Currency = currency;
  transfer.DebitedFunds.Amount = commissionCents;

  transfer.Fees = new api.models.Money();
  transfer.Fees.Currency = currency;
  transfer.Fees.Amount = 0;

  const created = await api.Transfers.create(transfer);
  console.log(`${LOG} Transfer Id=${created.Id} commission=${commissionCents} txn=${transactionId}`);
  return created;
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

/**
 * Create a Payout — move remaining funds from seller wallet to their IBAN.
 * Should be called after the 48h inspection window passes (escrow release).
 *
 * @param {{
 *   sellerMangoPayUserId: string,
 *   sellerWalletId: string,
 *   sellerBankAccountId: string,
 *   amountCents: number,
 *   currency: string,
 *   transactionId: string
 * }} data
 * @returns {Promise<object>} Payout object
 */
async function createPayout(data) {
  const api = getApi();
  const { sellerMangoPayUserId, sellerWalletId, sellerBankAccountId, amountCents, currency, transactionId } = data;

  const payout = new api.models.PayOut();
  payout.AuthorId = sellerMangoPayUserId;
  payout.DebitedWalletId = sellerWalletId;
  payout.BankAccountId = sellerBankAccountId;
  payout.Tag = `bidroom-payout:${transactionId}`;

  payout.DebitedFunds = new api.models.Money();
  payout.DebitedFunds.Currency = currency;
  payout.DebitedFunds.Amount = amountCents;

  payout.Fees = new api.models.Money();
  payout.Fees.Currency = currency;
  payout.Fees.Amount = 0;

  const created = await api.PayOuts.create(payout);
  console.log(`${LOG} Payout Id=${created.Id} amount=${amountCents} txn=${transactionId}`);
  return created;
}

/**
 * Get a Payout by ID.
 */
async function getPayout(payoutId) {
  const api = getApi();
  return api.PayOuts.get(payoutId);
}

// ─── Refunds ──────────────────────────────────────────────────────────────────

/**
 * Refund a PayIn — money goes back from seller's wallet to buyer's card.
 * Used when admin rules in buyer's favour (dispute).
 *
 * @param {string} payInId
 * @param {string} authorId — must be the same user who created the PayIn (buyer)
 * @param {{ amountCents: number, currency: string }} refundAmount — pass null for full refund
 * @returns {Promise<object>} Refund object
 */
async function createRefund(payInId, authorId, refundAmount = null) {
  const api = getApi();

  const refund = new api.models.Refund();
  refund.AuthorId = authorId;

  if (refundAmount) {
    refund.DebitedFunds = new api.models.Money();
    refund.DebitedFunds.Currency = refundAmount.currency;
    refund.DebitedFunds.Amount = refundAmount.amountCents;

    refund.Fees = new api.models.Money();
    refund.Fees.Currency = refundAmount.currency;
    refund.Fees.Amount = 0;
  }

  const created = await api.PayIns.createRefund(payInId, refund);
  console.log(`${LOG} Refund Id=${created.Id} for PayIn=${payInId}`);
  return created;
}

// ─── KYC ─────────────────────────────────────────────────────────────────────

/**
 * Get KYC documents for a user.
 */
async function getKycDocuments(mangoPayUserId) {
  const api = getApi();
  return api.Users.getKycDocuments(mangoPayUserId);
}

/**
 * Get full user details including KYCLevel.
 */
async function getUserKycLevel(mangoPayUserId) {
  const api = getApi();
  const user = await api.Users.get(mangoPayUserId);
  return user.KYCLevel; // 'LIGHT' or 'REGULAR'
}

// ─── Sandbox helpers ──────────────────────────────────────────────────────────

/**
 * SANDBOX ONLY — force a PayIn to succeed (for testing without real cards).
 * MangoPay sandbox accepts a test card number that auto-succeeds.
 * Test card: 4970105181818183 | Exp: any future | CVV: any 3 digits
 */
function getSandboxTestCard() {
  return {
    cardNumber: '4970105181818183',
    expiryMonth: '12',
    expiryYear: '29',
    cvv: '123'
  };
}

module.exports = {
  createNaturalUser,
  updateNaturalUser,
  getUser,
  createWallet,
  getWallet,
  createIbanBankAccount,
  deactivateBankAccount,
  createCardRegistration,
  finalizeCardRegistration,
  createDirectCardPayIn,
  getPayIn,
  createTransfer,
  createPayout,
  getPayout,
  createRefund,
  getKycDocuments,
  getUserKycLevel,
  getSandboxTestCard
};
