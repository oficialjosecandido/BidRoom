const Customer = require('../models/Customer');
const { getStripe } = require('../utils/stripe.util');

function migrateLegacyIfNeeded(user) {
  if ((!user.savedPaymentMethods || user.savedPaymentMethods.length === 0) && user.savedPaymentMethodId) {
    user.savedPaymentMethods = [{
      stripePaymentMethodId: user.savedPaymentMethodId,
      brand: user.savedPaymentMethodBrand || 'unknown',
      last4: user.savedPaymentMethodLast4 || null,
      expiry: user.savedPaymentMethodExpiry || null,
      isDefault: true,
      addedAt: new Date(),
    }];
  }
}

function syncFlatFields(user) {
  const def = (user.savedPaymentMethods || []).find((m) => m.isDefault);
  if (def) {
    user.savedPaymentMethodId = def.stripePaymentMethodId;
    user.savedPaymentMethodBrand = def.brand;
    user.savedPaymentMethodLast4 = def.last4;
    user.savedPaymentMethodExpiry = def.expiry;
  } else {
    user.savedPaymentMethodId = null;
    user.savedPaymentMethodBrand = null;
    user.savedPaymentMethodLast4 = null;
    user.savedPaymentMethodExpiry = null;
  }
}

function formatMethodsResponse(user) {
  migrateLegacyIfNeeded(user);
  const methods = (user.savedPaymentMethods || []).map((m) => ({
    id: m.stripePaymentMethodId,
    brand: m.brand,
    last4: m.last4,
    expiry: m.expiry,
    isDefault: !!m.isDefault,
  }));
  return {
    saved: methods.length > 0,
    methods,
    trustTier: user.buyerTrustTier,
  };
}

async function loadUserForPaymentMethods(uid) {
  const user = await Customer.findOne({ uid }).select(
    'savedPaymentMethods savedPaymentMethodId savedPaymentMethodBrand savedPaymentMethodLast4 savedPaymentMethodExpiry stripeCustomerId kycStatus emailVerified'
  );
  if (!user) return null;
  migrateLegacyIfNeeded(user);
  return user;
}

async function attachPaymentMethodToUser(uid, pmId, options = {}) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Payments not configured');

  const user = await loadUserForPaymentMethods(uid);
  if (!user) throw new Error('User not found');

  const pm = await stripe.paymentMethods.retrieve(pmId);
  if (!pm || pm.type !== 'card') throw new Error('Invalid payment method');

  const card = pm.card;
  const expiry = card ? `${String(card.exp_month).padStart(2, '0')}/${card.exp_year}` : null;

  const methods = user.savedPaymentMethods || [];
  const existing = methods.find((m) => m.stripePaymentMethodId === pmId);

  if (existing) {
    if (options.setAsDefault) {
      methods.forEach((m) => { m.isDefault = m.stripePaymentMethodId === pmId; });
      user.savedPaymentMethods = methods;
      syncFlatFields(user);
      await user.save();
    }
    return formatMethodsResponse(user);
  }

  const isFirst = methods.length === 0;
  const makeDefault = options.setAsDefault ?? isFirst;
  if (makeDefault) {
    methods.forEach((m) => { m.isDefault = false; });
  }

  methods.push({
    stripePaymentMethodId: pmId,
    brand: card?.brand ?? 'unknown',
    last4: card?.last4 ?? null,
    expiry,
    isDefault: makeDefault,
    addedAt: new Date(),
  });

  user.savedPaymentMethods = methods;
  syncFlatFields(user);
  await user.save();
  return formatMethodsResponse(user);
}

async function setDefaultPaymentMethod(uid, pmId) {
  const user = await loadUserForPaymentMethods(uid);
  if (!user) throw new Error('User not found');

  const methods = user.savedPaymentMethods || [];
  const target = methods.find((m) => m.stripePaymentMethodId === pmId);
  if (!target) throw new Error('Payment method not found');

  methods.forEach((m) => { m.isDefault = m.stripePaymentMethodId === pmId; });
  user.savedPaymentMethods = methods;
  syncFlatFields(user);
  await user.save();
  return formatMethodsResponse(user);
}

async function removePaymentMethod(uid, pmId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Payments not configured');

  const user = await loadUserForPaymentMethods(uid);
  if (!user) throw new Error('User not found');
  if (user.isModified('savedPaymentMethods')) await user.save();

  const methods = user.savedPaymentMethods || [];
  const target = methods.find((m) => m.stripePaymentMethodId === pmId);
  if (!target) throw new Error('Payment method not found');

  if (target.isDefault) {
    const err = new Error('Cannot remove default payment method');
    err.code = 'DEFAULT_PAYMENT_METHOD';
    throw err;
  }

  if (methods.length <= 1) {
    const err = new Error('Cannot remove the only payment method');
    err.code = 'ONLY_PAYMENT_METHOD';
    throw err;
  }

  try {
    await stripe.paymentMethods.detach(pmId);
  } catch (stripeErr) {
    // Already detached in Stripe — still remove from our records
    if (stripeErr?.code !== 'resource_missing') throw stripeErr;
  }

  user.savedPaymentMethods = methods.filter((m) => m.stripePaymentMethodId !== pmId);
  syncFlatFields(user);
  await user.save();
  return formatMethodsResponse(user);
}

async function confirmSetupIntent(uid, setupIntentId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Payments not configured');

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  if (setupIntent.metadata?.uid !== uid) {
    const err = new Error('Setup intent does not belong to this user');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (setupIntent.status !== 'succeeded') {
    const err = new Error('Setup intent not completed');
    err.code = 'SETUP_INCOMPLETE';
    throw err;
  }
  if (!setupIntent.payment_method) {
    throw new Error('No payment method on setup intent');
  }

  return attachPaymentMethodToUser(uid, setupIntent.payment_method);
}

module.exports = {
  migrateLegacyIfNeeded,
  syncFlatFields,
  formatMethodsResponse,
  loadUserForPaymentMethods,
  attachPaymentMethodToUser,
  setDefaultPaymentMethod,
  removePaymentMethod,
  confirmSetupIntent,
};
