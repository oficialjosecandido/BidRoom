/**
 * Auction End Scheduler
 * Checks for ended auctions and sends notifications
 */

const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const { handleAuctionEnd, handlePrivateRoomEnd, handlePrivateRoomClosedNoAcceptance, handlePrivateRoomEligibleExpired } = require('./auctionNotificationService');
const { checkAndApplyPendingSuspensions } = require('./accountStatusService');
const { processPrivateRoomNonPayments, sendPaymentDeadlineWarnings } = require('./privateRoomPaymentService');
const { processAllNonPayments } = require('./nonPaymentPenaltyService');
const { processAutoRelists } = require('./autoRelistService');
const { notifyWatchlistersAuctionEnding } = require('./notificationService');
const logger = require('../utils/logger');

let checkInterval = null;
let ioInstance = null;

/**
 * Check for ended auctions and process them (regular auctions and private rooms past their end time)
 */
async function checkEndedAuctions() {
  try {
    const now = new Date();
    let processed = 0;

    // -1) Listings in 'eligible' state past winnerSelectionDeadline (seller didn't create room in 15 min) → auto-select highest bidder
    const eligiblePastDeadline = await Listing.find({
      status: 'ended',
      privateRoomStatus: 'eligible',
      winnerSelectionDeadline: { $lte: now }
    });
    for (const listing of eligiblePastDeadline) {
      try {
        await handlePrivateRoomEligibleExpired(listing._id, ioInstance);
        processed++;
        logger.info(`✅ Private room eligible expired (auto-selected winner): ${listing._id} - ${listing.title}`);
      } catch (error) {
        logger.error(`❌ Error processing eligible-expired listing ${listing._id}:`, error.message);
      }
    }

    // 0) Private rooms in 'invited' state past acceptance deadline → auto-start the room (15 min passed)
    const PRIVATE_ROOM_EXTEND_MS = 60 * 1000;
    const invitedPastDeadline = await Listing.find({
      status: 'active',
      privateRoomStatus: 'invited',
      platinumBidderAcceptanceDeadline: { $lte: now }
    });
    for (const listing of invitedPastDeadline) {
      try {
        const invitations = listing.platinumBidderInvitations || [];
        const acceptedCount = invitations.filter(inv => inv.status === 'accepted').length;

        if (acceptedCount === 0) {
          // No one accepted → close auction without winner, notify seller and invited buyers
          await handlePrivateRoomClosedNoAcceptance(listing._id, ioInstance);
          processed++;
          logger.info(`✅ Private room closed (no acceptances): ${listing._id} - ${listing.title}`);
        } else {
          // 1+ accepted → auto-start the room (single bidder proceeds normally; wins after 60s with no competition)
          const roomEndDate = new Date(now.getTime() + PRIVATE_ROOM_EXTEND_MS);
          await Listing.findByIdAndUpdate(listing._id, {
            $set: {
              status: 'active',
              privateRoomStatus: 'active',
              privateRoomEndDate: roomEndDate,
              privateRoomLastBidTime: now,
              endDate: roomEndDate
            }
          }, { runValidators: false });
          processed++;
          logger.info(`✅ Auto-started private room (${acceptedCount} accepted): ${listing._id} - ${listing.title}`);
          if (ioInstance) {
            ioInstance.to(`listing:${listing._id}`).emit('listing-update', {
              listingId: listing._id.toString(),
              status: 'active',
              privateRoomStatus: 'active',
              privateRoomEndDate: roomEndDate.toISOString(),
              endDate: roomEndDate.toISOString(),
              currentPrice: listing.currentPrice,
              bidCount: listing.bidCount || 0
            });
          }
        }
      } catch (error) {
        logger.error(`❌ Error processing private room (invited past deadline) ${listing._id}:`, error.message);
      }
    }

    // 1) Regular auctions: endDate passed, not in active private room and not invited
    const endedAuctions = await Listing.find({
      status: 'active',
      endDate: { $lte: now },
      privateRoomStatus: { $nin: ['active', 'invited'] }
    }).populate('seller', 'email');

    for (const listing of endedAuctions) {
      try {
        // Collect bidders before ending so we can check them for pending suspensions after
        const bidderIds = await Bid.distinct('bidder', { listing: listing._id });
        await handleAuctionEnd(listing._id, ioInstance);
        processed++;
        logger.info(`✅ Processed ended auction: ${listing._id} - ${listing.title}`);
        // After auction ends, apply any deferred suspensions for participants who have no other active auctions
        const sellerId = listing.seller?._id || listing.seller;
        checkAndApplyPendingSuspensions([sellerId, ...bidderIds], ioInstance)
          .catch(err => logger.error(`❌ Pending suspension check error for listing ${listing._id}:`, err.message));
      } catch (error) {
        logger.error(`❌ Error processing auction ${listing._id}:`, error.message);
      }
    }

    // 2) Active private rooms whose privateRoomEndDate has passed
    const endedPrivateRooms = await Listing.find({
      status: 'active',
      privateRoomStatus: 'active',
      privateRoomEndDate: { $lte: now }
    });

    for (const listing of endedPrivateRooms) {
      try {
        const bidderIds = await Bid.distinct('bidder', { listing: listing._id });
        await handlePrivateRoomEnd(listing._id, ioInstance);
        processed++;
        logger.info(`✅ Closed private room (time expired): ${listing._id} - ${listing.title}`);
        const sellerId = listing.seller?._id || listing.seller;
        checkAndApplyPendingSuspensions([sellerId, ...bidderIds], ioInstance)
          .catch(err => logger.error(`❌ Pending suspension check error for private room ${listing._id}:`, err.message));
      } catch (error) {
        logger.error(`❌ Error closing private room ${listing._id}:`, error.message);
      }
    }

    // 3) Payment warnings + non-payment enforcement (private rooms + all other formats)
    await sendPaymentDeadlineWarnings(ioInstance).catch(err =>
      logger.error('❌ Payment deadline warnings error:', err.message)
    );
    await processPrivateRoomNonPayments(ioInstance).catch(err =>
      logger.error('❌ Private-room non-payment processing error:', err.message)
    );
    await processAllNonPayments(ioInstance).catch(err =>
      logger.error('❌ Non-payment penalty processing error:', err.message)
    );
    await processAutoRelists(ioInstance).catch(err =>
      logger.error('❌ Auto-relist processing error:', err.message)
    );

    // 4) Watchlist ending-soon alerts: active listings ending in < 1h
    const soonCutoff = new Date(now.getTime() + 60 * 60 * 1000);
    const endingSoonListings = await Listing.find({
      status: 'active',
      endDate: { $gt: now, $lte: soonCutoff },
      privateRoomStatus: { $nin: ['active', 'invited'] }
    }).select('_id title slug').lean();

    for (const listing of endingSoonListings) {
      notifyWatchlistersAuctionEnding({
        listingId: listing._id,
        listingTitle: listing.title,
        listingSlug: listing.slug,
        io: ioInstance
      }).catch(err => logger.error(`❌ Watchlist ending-soon error for ${listing._id}:`, err.message));
    }

    if (invitedPastDeadline.length > 0 || endedAuctions.length > 0 || endedPrivateRooms.length > 0) {
      logger.info(`🔍 Processed ${processed} (auto-started / ended auction(s) / private room(s))`);
    }

    return { processed };
  } catch (error) {
    logger.error('Error checking ended auctions:', error);
    throw error;
  }
}

/**
 * Start the scheduler
 * @param {number} intervalMinutes - How often to check (default: 1 minute)
 * @param {object} io - Socket.io instance for real-time updates
 */
function startScheduler(intervalMinutes = 1, io = null) {
  if (checkInterval) {
    logger.info('⚠️  Scheduler already running');
    return;
  }

  ioInstance = io; // Store io instance for socket events

  logger.info(`⏰ Starting auction end scheduler (checking every ${intervalMinutes} minute(s))`);

  // Check immediately on start
  checkEndedAuctions().catch(err => {
    logger.error('Error in initial auction check:', err);
  });

  // Then check at intervals
  checkInterval = setInterval(() => {
    checkEndedAuctions().catch(err => {
      logger.error('Error in scheduled auction check:', err);
    });
  }, intervalMinutes * 60 * 1000);
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    logger.info('⏰ Auction end scheduler stopped');
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  checkEndedAuctions
};

