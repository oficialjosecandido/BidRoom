'use strict';

const VehicleTransaction = require('../models/VehicleTransaction');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const { getStripe } = require('../utils/stripe.util');
const { sendEmail } = require('./emailService');
const { wrapBidRoomEmail, emailInfoBox, transactionUrl } = require('../utils/bidroomEmailLayout');
const logger = require('../utils/logger');

const SETUP_WINDOW_MS        = 12 * 60 * 60 * 1000;   // 12 h
const TRANSACTION_WINDOW_DAYS = 3;                      // 3 calendar days
const CONFIRM_WINDOW_MS      = 48 * 60 * 60 * 1000;   // 48 h
const DEPOSIT_AMOUNT_CENTS   = 10_000;                  // €100
const DEPOSIT_AMOUNT_EUR     = 100;
const SELLER_FEE_CENTS       = parseInt(process.env.VEHICLE_SUCCESS_FEE_CENTS || '10000', 10);
const SELLER_FEE_EUR         = SELLER_FEE_CENTS / 100;

function addCalendarDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function vehicleTransactionUrl(vtId) {
  const base = (process.env.FRONTEND_URL || 'https://www.bidroom.pt').replace(/\/$/, '');
  return `${base}/dashboard/vehicle-transactions/${vtId}`;
}

// ── Email helpers ─────────────────────────────────────────────────────────────

function emailSubject(prefix, listingTitle) {
  return `${prefix}: ${listingTitle}`;
}

async function sendVehicleEmail(to, subject, bodyHtml, textFallback) {
  const html = wrapBidRoomEmail({ body: bodyHtml, text: textFallback || subject });
  await sendEmail(to, subject, html).catch(e => logger.error('[vehicleEmail] send error', { to, error: e.message }));
}

async function notifySetupRequired(vt, listing, buyer, seller) {
  const url = vehicleTransactionUrl(vt._id);
  const title = listing?.title || 'Veículo';
  const price = `€${vt.agreedPrice.toFixed(2)}`;

  // Buyer: authorize deposit
  await sendVehicleEmail(
    buyer.email,
    emailSubject('Ação necessária: autorize a caução', title),
    emailInfoBox(`<p style="margin:0 0 16px;color:#334155;">Olá <strong>${buyer.firstName}</strong>,</p>
<p style="margin:0 0 16px;color:#334155;">Ganhou o leilão de <strong>${title}</strong> por <strong>${price}</strong>.</p>
<p style="margin:0 0 16px;color:#334155;">Para prosseguir tem de autorizar uma caução de <strong>€${DEPOSIT_AMOUNT_EUR}</strong> nos próximos <strong>12 horas</strong>.</p>
<p style="margin:0 0 4px;color:#334155;">A caução é devolvida automaticamente quando o negócio for concluído.</p>`,
      url, 'Autorizar caução', title, `Leilão ganho — ${title} (${price})`
    )
  );

  // Seller: pay success fee
  await sendVehicleEmail(
    seller.email,
    emailSubject('Ação necessária: pague a taxa de sucesso', title),
    emailInfoBox(`<p style="margin:0 0 16px;color:#334155;">Olá <strong>${seller.firstName}</strong>,</p>
<p style="margin:0 0 16px;color:#334155;">O seu leilão de <strong>${title}</strong> foi concluído por <strong>${price}</strong>.</p>
<p style="margin:0 0 16px;color:#334155;">Tem de pagar a taxa de sucesso BidRoom de <strong>€${SELLER_FEE_EUR}</strong> nas próximas <strong>12 horas</strong> para prosseguir.</p>`,
      url, 'Pagar taxa', title, `Leilão concluído — ${title} (${price})`
    )
  );
}

async function notifyParties(vt, listing, buyer, seller) {
  const url = vehicleTransactionUrl(vt._id);
  const title = listing?.title || 'Veículo';
  const deadline = new Date(vt.transactionDeadline).toLocaleDateString('pt-PT');

  await sendVehicleEmail(
    buyer.email,
    emailSubject('Apresentação das partes — negócio pode começar', title),
    emailInfoBox(`<p style="margin:0 0 16px;color:#334155;">Olá <strong>${buyer.firstName}</strong>,</p>
<p style="margin:0 0 16px;color:#334155;">Ambas as partes concluíram a configuração. Pode contactar o vendedor:</p>
<p style="margin:0 0 4px;color:#334155;"><strong>Vendedor:</strong> ${seller.firstName} ${seller.lastName}<br><strong>Email:</strong> ${seller.email}</p>
<p style="margin:0 16px 0;color:#334155;"><strong>Prazo para concluir:</strong> ${deadline}</p>`,
      url, 'Ver transação', title, `Negócio iniciado — ${title}`
    )
  );

  await sendVehicleEmail(
    seller.email,
    emailSubject('Apresentação das partes — negócio pode começar', title),
    emailInfoBox(`<p style="margin:0 0 16px;color:#334155;">Olá <strong>${seller.firstName}</strong>,</p>
<p style="margin:0 0 16px;color:#334155;">Ambas as partes concluíram a configuração. Pode contactar o comprador:</p>
<p style="margin:0 0 4px;color:#334155;"><strong>Comprador:</strong> ${buyer.firstName} ${buyer.lastName}<br><strong>Email:</strong> ${buyer.email}</p>
<p style="margin:0 16px 0;color:#334155;"><strong>Prazo para concluir:</strong> ${deadline}</p>`,
      url, 'Ver transação', title, `Negócio iniciado — ${title}`
    )
  );
}

async function notifyOtherPartyToConfirm(vt, listing, confirmerParty, otherParty) {
  const url = vehicleTransactionUrl(vt._id);
  const title = listing?.title || 'Veículo';
  const windowEnd = new Date(vt.confirmationDeadline).toLocaleString('pt-PT');
  const confirmerName = confirmerParty.firstName;

  await sendVehicleEmail(
    otherParty.email,
    emailSubject('Confirmação de negócio necessária', title),
    emailInfoBox(`<p style="margin:0 0 16px;color:#334155;">Olá <strong>${otherParty.firstName}</strong>,</p>
<p style="margin:0 0 16px;color:#334155;"><strong>${confirmerName}</strong> marcou o negócio de <strong>${title}</strong> como concluído.</p>
<p style="margin:0 0 16px;color:#334155;">Tem até <strong>${windowEnd}</strong> para confirmar ou contestar. Se não fizer nada, considera-se concluído automaticamente e a caução é libertada.</p>`,
      url, 'Confirmar ou contestar', title, `Confirme a conclusão — ${title}`
    )
  );
}

async function notifyCompletion(vt, listing, buyer, seller) {
  const url = vehicleTransactionUrl(vt._id);
  const title = listing?.title || 'Veículo';

  for (const party of [buyer, seller]) {
    await sendVehicleEmail(
      party.email,
      emailSubject('Negócio concluído — caução libertada', title),
      emailInfoBox(`<p style="margin:0 0 16px;color:#334155;">Olá <strong>${party.firstName}</strong>,</p>
<p style="margin:0 0 16px;color:#334155;">O negócio de <strong>${title}</strong> foi concluído com sucesso.</p>
<p style="margin:0 0 4px;color:#334155;">A caução de €${DEPOSIT_AMOUNT_EUR} foi libertada ao comprador.</p>`,
        url, 'Ver transação', title, `Concluído — ${title}`
      )
    );
  }
}

async function notifyDepositCaptured(vt, listing, buyer, seller) {
  const url = vehicleTransactionUrl(vt._id);
  const title = listing?.title || 'Veículo';

  await sendVehicleEmail(
    buyer.email,
    emailSubject('Caução capturada — prazo expirado', title),
    emailInfoBox(`<p style="margin:0 0 16px;color:#334155;">Olá <strong>${buyer.firstName}</strong>,</p>
<p style="margin:0 0 16px;color:#334155;">O prazo para concluir o negócio de <strong>${title}</strong> expirou sem confirmação de conclusão.</p>
<p style="margin:0 0 4px;color:#334155;">A caução de €${DEPOSIT_AMOUNT_EUR} foi capturada pela BidRoom, conforme os termos aceites ao licitar.</p>`,
      url, 'Ver transação', title, `Caução capturada — ${title}`
    )
  );

  await sendVehicleEmail(
    seller.email,
    emailSubject('Negócio não concluído — prazo expirado', title),
    emailInfoBox(`<p style="margin:0 0 16px;color:#334155;">Olá <strong>${seller.firstName}</strong>,</p>
<p style="margin:0 0 16px;color:#334155;">O negócio de <strong>${title}</strong> não foi confirmado dentro do prazo.</p>
<p style="margin:0 0 4px;color:#334155;">A caução do comprador foi capturada. A taxa de sucesso não é reembolsável.</p>`,
      url, 'Ver transação', title, `Prazo expirado — ${title}`
    )
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadParties(vt) {
  const [buyer, seller, listing] = await Promise.all([
    Customer.findById(vt.buyer).lean(),
    Customer.findById(vt.seller).lean(),
    Listing.findById(vt.listing).lean(),
  ]);
  return { buyer, seller, listing };
}

// ── Core business logic ───────────────────────────────────────────────────────

/**
 * Create VehicleTransaction when a vehicle auction closes with a winner.
 * Called from auctionNotificationService instead of createTransactionForListing.
 */
async function createVehicleTransaction(listingId, winnerId, sellerId, agreedPrice) {
  try {
    const existing = await VehicleTransaction.findOne({ listing: listingId });
    if (existing) return existing;

    const feeAmount = SELLER_FEE_CENTS / 100;
    const now = new Date();
    const setupDeadline = new Date(now.getTime() + SETUP_WINDOW_MS);
    const transactionDeadline = addCalendarDays(now, TRANSACTION_WINDOW_DAYS);

    const vt = await VehicleTransaction.create({
      listing: listingId,
      buyer:   winnerId,
      seller:  sellerId,
      agreedPrice,
      deposit:   { amount: DEPOSIT_AMOUNT_EUR, status: 'pending' },
      sellerFee: { amount: feeAmount, status: 'pending' },
      status: 'awaiting_setup',
      setupDeadline,
      transactionDeadline,
    });

    logger.info(`[vehicleTransaction] Created ${vt._id} for listing ${listingId}`);

    // Notify both parties async
    loadParties(vt).then(({ buyer, seller, listing }) => {
      if (buyer && seller) notifySetupRequired(vt, listing, buyer, seller);
    }).catch(e => logger.error('[vehicleTransaction] notifySetupRequired error', { error: e.message }));

    return vt;
  } catch (err) {
    if (err.code === 11000) return VehicleTransaction.findOne({ listing: listingId });
    throw err;
  }
}

/**
 * Attempt to authorize the buyer deposit off_session.
 * Returns { status, clientSecret? } where status ∈ 'authorized' | 'requires_action' | 'failed' | 'no_payment_method'.
 */
async function attemptBuyerDeposit(vtId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const vt = await VehicleTransaction.findById(vtId);
  if (!vt) throw new Error('VehicleTransaction not found');
  if (vt.deposit.status === 'authorized') return { status: 'authorized' };

  const buyer = await Customer.findById(vt.buyer).lean();
  const pm = buyer?.savedPaymentMethods?.find(p => p.isDefault) ?? buyer?.savedPaymentMethods?.[0] ?? null;
  if (!pm || !buyer?.stripeCustomerId) {
    return { status: 'no_payment_method' };
  }

  try {
    const pi = await stripe.paymentIntents.create({
      amount: DEPOSIT_AMOUNT_CENTS,
      currency: 'eur',
      customer: buyer.stripeCustomerId,
      payment_method: pm.stripePaymentMethodId,
      capture_method: 'manual',
      off_session: true,
      confirm: true,
      description: `BidRoom — caução veículo (${vtId})`,
      metadata: { vehicleTxId: vtId.toString(), purpose: 'vehicle_deposit' },
    });

    if (pi.status === 'requires_capture') {
      await VehicleTransaction.updateOne({ _id: vtId }, {
        $set: {
          'deposit.stripePaymentIntentId': pi.id,
          'deposit.status': 'authorized',
          'deposit.authorizedAt': new Date(),
          'deposit.clientSecret': null,
        }
      });
      return { status: 'authorized' };
    }

    if (pi.status === 'requires_action') {
      await VehicleTransaction.updateOne({ _id: vtId }, {
        $set: {
          'deposit.stripePaymentIntentId': pi.id,
          'deposit.status': 'requires_action',
          'deposit.clientSecret': pi.client_secret,
        }
      });
      return { status: 'requires_action', clientSecret: pi.client_secret };
    }

    await VehicleTransaction.updateOne({ _id: vtId }, { $set: { 'deposit.status': 'failed' } });
    return { status: 'failed' };
  } catch (stripeErr) {
    if (stripeErr.code === 'authentication_required') {
      // SCA required but not possible off-session — create without off_session for frontend confirmation
      const pi = await stripe.paymentIntents.create({
        amount: DEPOSIT_AMOUNT_CENTS,
        currency: 'eur',
        customer: buyer.stripeCustomerId,
        payment_method: pm.stripePaymentMethodId,
        capture_method: 'manual',
        description: `BidRoom — caução veículo (${vtId})`,
        metadata: { vehicleTxId: vtId.toString(), purpose: 'vehicle_deposit' },
      });
      await VehicleTransaction.updateOne({ _id: vtId }, {
        $set: {
          'deposit.stripePaymentIntentId': pi.id,
          'deposit.status': 'requires_action',
          'deposit.clientSecret': pi.client_secret,
        }
      });
      return { status: 'requires_action', clientSecret: pi.client_secret };
    }
    await VehicleTransaction.updateOne({ _id: vtId }, { $set: { 'deposit.status': 'failed' } });
    return { status: 'failed', error: stripeErr.message };
  }
}

/**
 * Confirm deposit after Stripe.js confirms the 3DS challenge on the frontend.
 */
async function confirmBuyerDeposit(vtId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const vt = await VehicleTransaction.findById(vtId).lean();
  if (!vt?.deposit?.stripePaymentIntentId) throw new Error('No payment intent');

  const pi = await stripe.paymentIntents.retrieve(vt.deposit.stripePaymentIntentId);
  if (pi.status !== 'requires_capture') {
    throw new Error(`Deposit not authorized (status: ${pi.status})`);
  }

  await VehicleTransaction.updateOne({ _id: vtId }, {
    $set: {
      'deposit.status': 'authorized',
      'deposit.authorizedAt': new Date(),
      'deposit.clientSecret': null,
    }
  });

  await checkBothSetupComplete(vtId);
}

/**
 * Charge the seller success fee off_session.
 */
async function attemptSellerFee(vtId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const vt = await VehicleTransaction.findById(vtId);
  if (!vt) throw new Error('VehicleTransaction not found');
  if (vt.sellerFee.status === 'paid') return { status: 'paid' };

  const seller = await Customer.findById(vt.seller).lean();
  const pm = seller?.savedPaymentMethods?.find(p => p.isDefault) ?? seller?.savedPaymentMethods?.[0] ?? null;
  if (!pm || !seller?.stripeCustomerId) {
    return { status: 'no_payment_method' };
  }

  try {
    const pi = await stripe.paymentIntents.create({
      amount: vt.sellerFee.amount * 100,
      currency: 'eur',
      customer: seller.stripeCustomerId,
      payment_method: pm.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      description: `BidRoom — taxa de sucesso veículo (${vtId})`,
      metadata: { vehicleTxId: vtId.toString(), purpose: 'vehicle_seller_fee' },
    });

    if (pi.status === 'succeeded') {
      await VehicleTransaction.updateOne({ _id: vtId }, {
        $set: {
          'sellerFee.stripePaymentIntentId': pi.id,
          'sellerFee.status': 'paid',
          'sellerFee.paidAt': new Date(),
          'sellerFee.clientSecret': null,
        }
      });
      await checkBothSetupComplete(vtId);
      return { status: 'paid' };
    }

    if (pi.status === 'requires_action') {
      await VehicleTransaction.updateOne({ _id: vtId }, {
        $set: {
          'sellerFee.stripePaymentIntentId': pi.id,
          'sellerFee.status': 'requires_action',
          'sellerFee.clientSecret': pi.client_secret,
        }
      });
      return { status: 'requires_action', clientSecret: pi.client_secret };
    }

    await VehicleTransaction.updateOne({ _id: vtId }, { $set: { 'sellerFee.status': 'failed' } });
    return { status: 'failed' };
  } catch (stripeErr) {
    if (stripeErr.code === 'authentication_required') {
      const pi = await stripe.paymentIntents.create({
        amount: vt.sellerFee.amount * 100,
        currency: 'eur',
        customer: seller.stripeCustomerId,
        payment_method: pm.stripePaymentMethodId,
        description: `BidRoom — taxa de sucesso veículo (${vtId})`,
        metadata: { vehicleTxId: vtId.toString(), purpose: 'vehicle_seller_fee' },
      });
      await VehicleTransaction.updateOne({ _id: vtId }, {
        $set: {
          'sellerFee.stripePaymentIntentId': pi.id,
          'sellerFee.status': 'requires_action',
          'sellerFee.clientSecret': pi.client_secret,
        }
      });
      return { status: 'requires_action', clientSecret: pi.client_secret };
    }
    await VehicleTransaction.updateOne({ _id: vtId }, { $set: { 'sellerFee.status': 'failed' } });
    return { status: 'failed', error: stripeErr.message };
  }
}

/**
 * Confirm seller fee after Stripe.js confirms the 3DS challenge.
 */
async function confirmSellerFee(vtId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const vt = await VehicleTransaction.findById(vtId).lean();
  if (!vt?.sellerFee?.stripePaymentIntentId) throw new Error('No payment intent');

  const pi = await stripe.paymentIntents.retrieve(vt.sellerFee.stripePaymentIntentId);
  if (pi.status !== 'succeeded') {
    throw new Error(`Fee not paid (status: ${pi.status})`);
  }

  await VehicleTransaction.updateOne({ _id: vtId }, {
    $set: {
      'sellerFee.status': 'paid',
      'sellerFee.paidAt': new Date(),
      'sellerFee.clientSecret': null,
    }
  });

  await checkBothSetupComplete(vtId);
}

/**
 * Check if both deposit and fee are done; if so, move to 'in_progress' and introduce parties.
 */
async function checkBothSetupComplete(vtId) {
  const vt = await VehicleTransaction.findById(vtId).lean();
  if (!vt || vt.status !== 'awaiting_setup') return;
  if (vt.deposit.status !== 'authorized') return;
  if (vt.sellerFee.status !== 'paid') return;

  await VehicleTransaction.updateOne({ _id: vtId }, { $set: { status: 'in_progress' } });

  loadParties({ buyer: vt.buyer, seller: vt.seller, listing: vt.listing }).then(({ buyer, seller, listing }) => {
    if (buyer && seller) notifyParties(vt, listing, buyer, seller);
  }).catch(e => logger.error('[vehicleTransaction] notifyParties error', { error: e.message }));
}

/**
 * Mark buyer or seller as having confirmed completion.
 * Implements asymmetric confirmation (Regra 1).
 */
async function confirmCompletion(vtId, userId) {
  const vt = await VehicleTransaction.findById(vtId);
  if (!vt) throw new Error('VehicleTransaction not found');
  if (!['in_progress', 'awaiting_confirmation'].includes(vt.status)) {
    throw new Error(`Cannot confirm in status: ${vt.status}`);
  }

  const buyerId  = (vt.buyer._id || vt.buyer).toString();
  const sellerId = (vt.seller._id || vt.seller).toString();
  const isBuyer  = buyerId === userId.toString();
  const isSeller = sellerId === userId.toString();
  if (!isBuyer && !isSeller) throw new Error('Not a party to this transaction');

  const now = new Date();
  if (isBuyer && !vt.completion.buyerConfirmed) {
    vt.completion.buyerConfirmed   = true;
    vt.completion.buyerConfirmedAt = now;
  }
  if (isSeller && !vt.completion.sellerConfirmed) {
    vt.completion.sellerConfirmed   = true;
    vt.completion.sellerConfirmedAt = now;
  }

  // Both confirmed → complete immediately
  if (vt.completion.buyerConfirmed && vt.completion.sellerConfirmed) {
    await vt.save();
    await completeTransaction(vtId);
    return;
  }

  // First confirmation → start 48h window
  if (!vt.completion.firstConfirmationAt) {
    vt.completion.firstConfirmationAt = now;
    vt.status = 'awaiting_confirmation';
    vt.confirmationDeadline = new Date(now.getTime() + CONFIRM_WINDOW_MS);
  }

  await vt.save();

  // Notify the other party
  const { buyer, seller, listing } = await loadParties(vt);
  const confirmer = isBuyer ? buyer : seller;
  const other     = isBuyer ? seller : buyer;
  if (confirmer && other) {
    await notifyOtherPartyToConfirm(vt, listing, confirmer, other);
  }
}

/**
 * Upload registration proof (buyer). Counts as confirmation; starts/extends 48h window.
 */
async function uploadRegistrationProof(vtId, proofUrl) {
  const vt = await VehicleTransaction.findById(vtId);
  if (!vt) throw new Error('VehicleTransaction not found');
  if (!['in_progress', 'awaiting_confirmation'].includes(vt.status)) {
    throw new Error(`Cannot upload proof in status: ${vt.status}`);
  }

  const now = new Date();
  vt.completion.registrationProofUrl = proofUrl;
  vt.completion.registrationProofUploadedAt = now;
  // Counts as buyer confirmation
  vt.completion.buyerConfirmed   = true;
  vt.completion.buyerConfirmedAt = now;

  if (!vt.completion.firstConfirmationAt) {
    vt.completion.firstConfirmationAt = now;
    vt.status = 'awaiting_confirmation';
    vt.confirmationDeadline = new Date(now.getTime() + CONFIRM_WINDOW_MS);
  }

  await vt.save();

  const { buyer, seller, listing } = await loadParties(vt);
  if (buyer && seller) {
    await loadParties(vt).then(() => notifyOtherPartyToConfirm(vt, listing, buyer, seller));
  }
}

/**
 * Release deposit (deal completed successfully).
 */
async function completeTransaction(vtId) {
  const stripe = getStripe();
  const vt = await VehicleTransaction.findById(vtId).lean();
  if (!vt || vt.status === 'completed') return;

  if (stripe && vt.deposit.stripePaymentIntentId && vt.deposit.status === 'authorized') {
    try {
      await stripe.paymentIntents.cancel(vt.deposit.stripePaymentIntentId);
    } catch (e) {
      logger.error('[vehicleTransaction] cancel PI error', { error: e.message });
    }
  }

  await VehicleTransaction.updateOne({ _id: vtId }, {
    $set: {
      status: 'completed',
      'deposit.status': 'released',
      'deposit.resolvedAt': new Date(),
    }
  });

  const { buyer, seller, listing } = await loadParties(vt);
  if (buyer && seller) notifyCompletion(vt, listing, buyer, seller).catch(() => {});
  logger.info(`[vehicleTransaction] Completed ${vtId}`);
}

/**
 * Capture deposit (deal failed — Option A: no-fault capture).
 */
async function failTransaction(vtId, reason = 'deadline_expired') {
  const stripe = getStripe();
  const vt = await VehicleTransaction.findById(vtId).lean();
  if (!vt || ['completed', 'failed', 'cancelled'].includes(vt.status)) return;

  if (stripe && vt.deposit.stripePaymentIntentId && vt.deposit.status === 'authorized') {
    try {
      await stripe.paymentIntents.capture(vt.deposit.stripePaymentIntentId);
    } catch (e) {
      logger.error('[vehicleTransaction] capture PI error', { error: e.message });
    }
  }

  await VehicleTransaction.updateOne({ _id: vtId }, {
    $set: {
      status: 'failed',
      failureReason: reason,
      'deposit.status': 'captured',
      'deposit.resolvedAt': new Date(),
    }
  });

  const { buyer, seller, listing } = await loadParties(vt);
  if (buyer && seller) notifyDepositCaptured(vt, listing, buyer, seller).catch(() => {});
  logger.info(`[vehicleTransaction] Failed ${vtId} (${reason})`);
}

/**
 * Cancel (setup failure — deposit released, fee not charged or refunded if needed).
 */
async function cancelTransaction(vtId, reason = 'setup_failed') {
  const stripe = getStripe();
  const vt = await VehicleTransaction.findById(vtId).lean();
  if (!vt || vt.status !== 'awaiting_setup') return;

  // Release deposit if it was authorized
  if (stripe && vt.deposit.stripePaymentIntentId && vt.deposit.status === 'authorized') {
    try {
      await stripe.paymentIntents.cancel(vt.deposit.stripePaymentIntentId);
    } catch (e) {
      logger.error('[vehicleTransaction] cancel deposit on setup-fail error', { error: e.message });
    }
  }

  await VehicleTransaction.updateOne({ _id: vtId }, {
    $set: {
      status: 'cancelled',
      failureReason: reason,
      'deposit.status': vt.deposit.status === 'authorized' ? 'released' : vt.deposit.status,
    }
  });

  logger.info(`[vehicleTransaction] Cancelled ${vtId} (${reason})`);
}

module.exports = {
  createVehicleTransaction,
  attemptBuyerDeposit,
  confirmBuyerDeposit,
  attemptSellerFee,
  confirmSellerFee,
  confirmCompletion,
  uploadRegistrationProof,
  completeTransaction,
  failTransaction,
  cancelTransaction,
  checkBothSetupComplete,
  DEPOSIT_AMOUNT_EUR,
  SELLER_FEE_EUR,
};
