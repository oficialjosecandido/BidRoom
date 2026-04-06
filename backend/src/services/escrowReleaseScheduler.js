/**
 * Escrow Release Scheduler
 *
 * Runs periodically (every 30 minutes by default) to find transactions where:
 *   - escrowStatus === 'pending_inspection'
 *   - escrowReleasesAt <= now
 *   - disputeOpen is false (or null)
 *
 * For each eligible transaction it triggers the MangoPay commission transfer
 * and seller payout, then sets escrowStatus to 'released'.
 *
 * Registered in index.js as a setInterval after the server starts.
 */

const Transaction = require('../models/Transaction');
const User = require('../models/User');
const mangoPayService = require('./mangoPayService');
const { sendEmail } = require('./emailService');
const { renderEmailTemplate } = require('./templateEngine');

const LOG = '[EscrowScheduler]';
const PLATFORM_WALLET_ID = process.env.MANGOPAY_PLATFORM_WALLET_ID;
const PLATFORM_USER_ID = process.env.MANGOPAY_PLATFORM_USER_ID;
const PLATFORM_FEE_RATE = 0.02;

/**
 * Find all transactions ready for escrow release and process them.
 * Designed to be called on an interval — errors per transaction are logged but do not abort the run.
 */
async function runEscrowRelease() {
  const now = new Date();
  let processed = 0;
  let errors = 0;

  try {
    const eligible = await Transaction.find({
      escrowStatus: 'pending_inspection',
      escrowReleasesAt: { $lte: now },
      disputeOpen: { $ne: true }
    }).populate('seller buyer listing');

    if (eligible.length === 0) return;

    console.log(`${LOG} Found ${eligible.length} transaction(s) ready for escrow release`);

    for (const tx of eligible) {
      try {
        await releaseEscrow(tx);
        processed++;
      } catch (err) {
        errors++;
        console.error(`${LOG} Failed to release escrow for tx ${tx._id}:`, err.message);
      }
    }

    console.log(`${LOG} Escrow release run complete — ${processed} released, ${errors} errors`);
  } catch (err) {
    console.error(`${LOG} Scheduler query failed:`, err.message);
  }
}

async function releaseEscrow(tx) {
  const seller = tx.seller;
  if (!seller?.mangoPayWalletId || !seller?.mangoPayUserId) {
    throw new Error(`Seller ${seller?._id} has no MangoPay wallet`);
  }
  if (!tx.mangoPayPayInId) {
    throw new Error(`Transaction ${tx._id} has no mangoPayPayInId`);
  }
  if (!PLATFORM_WALLET_ID || !PLATFORM_USER_ID) {
    throw new Error('MANGOPAY_PLATFORM_WALLET_ID / MANGOPAY_PLATFORM_USER_ID not configured');
  }

  const bidRoomFeeAmount = Math.round(tx.amount * PLATFORM_FEE_RATE * 100); // in cents
  const sellerNetCents = Math.round(tx.amount * 100) - bidRoomFeeAmount;

  // Step 1: Transfer platform fee from seller wallet → platform wallet
  const transfer = await mangoPayService.createTransfer({
    authorId: seller.mangoPayUserId,
    debitedWalletId: seller.mangoPayWalletId,
    creditedWalletId: PLATFORM_WALLET_ID,
    debitedFunds: { Currency: 'EUR', Amount: bidRoomFeeAmount },
    fees: { Currency: 'EUR', Amount: 0 },
    tag: `Commission tx:${tx._id}`
  });

  // Step 2: Payout remaining funds to seller IBAN
  const payout = await mangoPayService.createPayout({
    authorId: seller.mangoPayUserId,
    debitedWalletId: seller.mangoPayWalletId,
    debitedFunds: { Currency: 'EUR', Amount: sellerNetCents },
    fees: { Currency: 'EUR', Amount: 0 },
    bankAccountId: seller.mangoPayBankAccountId,
    tag: `Payout tx:${tx._id}`
  });

  // Step 3: Persist IDs and update status
  await Transaction.findByIdAndUpdate(tx._id, {
    $set: {
      mangoPayTransferId: transfer.Id,
      mangoPayPayoutId: payout.Id,
      escrowStatus: 'released',
      sellerPayoutAmount: sellerNetCents / 100,
      bidRoomFeeAmount: bidRoomFeeAmount / 100
    }
  }, { runValidators: false });

  console.log(`${LOG} Released escrow for tx ${tx._id} — payout ${payout.Id}`);

  // Step 4: Notify seller
  try {
    const listingTitle = tx.listing?.title || 'your item';
    const sellerPayoutDollars = sellerNetCents / 100;
    const body = await renderEmailTemplate('escrowReleasedSeller', {
      sellerName: seller.firstName,
      listingTitle,
      payoutAmount: `$${sellerPayoutDollars.toFixed(2)}`
    });
    if (body) {
      await sendEmail({ to: seller.email, subject: `Payout sent: ${listingTitle}`, html: body });
    }
  } catch (emailErr) {
    console.warn(`${LOG} Could not send payout email for tx ${tx._id}:`, emailErr.message);
  }
}

/**
 * Start the scheduler. Call from index.js after server starts.
 * @param {number} intervalMinutes — how often to check (default: 30)
 */
function startScheduler(intervalMinutes = 30) {
  const intervalMs = intervalMinutes * 60 * 1000;

  // Run once immediately on startup (catches any overdue items from downtime)
  setTimeout(() => runEscrowRelease().catch(e => console.error(`${LOG} Initial run error:`, e.message)), 5000);

  setInterval(() => runEscrowRelease().catch(e => console.error(`${LOG} Scheduled run error:`, e.message)), intervalMs);

  console.log(`${LOG} Escrow release scheduler started (interval: ${intervalMinutes} min)`);
}

module.exports = { startScheduler, runEscrowRelease };
