/**
 * Auction End Scheduler
 * Checks for ended auctions and sends notifications
 * Also checks for expired platinum bidder acceptance windows
 */

const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const { handleAuctionEnd, handleWinnerSelection } = require('./auctionNotificationService');

let checkInterval = null;
let ioInstance = null;

/**
 * Check for ended auctions and process them
 */
async function checkEndedAuctions() {
  try {
    const now = new Date();
    
    // Find auctions that have ended but haven't been processed yet
    const endedAuctions = await Listing.find({
      status: 'active',
      endDate: { $lte: now },
      privateRoomStatus: { $ne: 'active' } // Only check regular auctions, not private room
    }).populate('seller', 'email');

    console.log(`🔍 Found ${endedAuctions.length} ended auction(s) to process`);

    for (const listing of endedAuctions) {
      try {
        await handleAuctionEnd(listing._id);
        console.log(`✅ Processed ended auction: ${listing._id} - ${listing.title}`);
      } catch (error) {
        console.error(`❌ Error processing auction ${listing._id}:`, error.message);
      }
    }

    // Check for expired acceptance windows (5-minute window passed)
    const expiredWindows = await Listing.find({
      status: 'ended',
      privateRoomStatus: 'eligible',
      platinumBidderAcceptanceDeadline: { $lte: now }
    }).populate('seller', 'firstName lastName email');

    console.log(`🔍 Found ${expiredWindows.length} expired acceptance window(s) to process`);

    for (const listing of expiredWindows) {
      try {
        await processExpiredAcceptanceWindow(listing._id);
        console.log(`✅ Processed expired acceptance window: ${listing._id} - ${listing.title}`);
      } catch (error) {
        console.error(`❌ Error processing expired window ${listing._id}:`, error.message);
      }
    }

    return { processed: endedAuctions.length, expiredWindows: expiredWindows.length };
  } catch (error) {
    console.error('Error checking ended auctions:', error);
    throw error;
  }
}

/**
 * Process expired acceptance window
 * Either start private room if bidders accepted, or select highest bidder as winner
 */
async function processExpiredAcceptanceWindow(listingId) {
  try {
    const listing = await Listing.findById(listingId)
      .populate('seller', 'firstName lastName email');

    if (!listing) {
      throw new Error('Listing not found');
    }

    // Check how many platinum bidders accepted
    const acceptedCount = listing.platinumBidderInvitations.filter(
      inv => inv.status === 'accepted'
    ).length;

    if (acceptedCount > 0) {
      // At least one accepted - start private room
      const now = new Date();
      const privateRoomEndDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

      listing.privateRoomStatus = 'active';
      listing.privateRoomEndDate = privateRoomEndDate;
      listing.status = 'active'; // Reactivate for private room
      listing.endDate = privateRoomEndDate;
      listing.platinumBidderAcceptanceDeadline = null; // Clear deadline

      await listing.save();

      console.log(`🔒 Private room started for listing: ${listingId} with ${acceptedCount} accepted bidders`);

      // Emit socket event if available
      if (ioInstance) {
        ioInstance.to(`listing:${listingId}`).emit('listing-updated', {
          listingId: listing._id.toString(),
          privateRoomStatus: listing.privateRoomStatus,
          privateRoomEndDate: listing.privateRoomEndDate,
          endDate: listing.endDate,
          status: listing.status
        });
      }

      return { action: 'privateRoomStarted', acceptedCount };
    } else {
      // No one accepted - select highest bidder as winner
      const highestBid = await Bid.findOne({ listing: listingId })
        .sort({ amount: -1 })
        .populate('bidder', 'firstName lastName email')
        .lean();

      if (highestBid && highestBid.bidder) {
        // Mark listing as ended and set winner
        listing.status = 'ended';
        listing.privateRoomStatus = 'not-triggered';
        listing.winner = highestBid.bidder._id;
        listing.winnerBid = highestBid._id;
        listing.winnerSelectedAt = new Date();
        listing.platinumBidderAcceptanceDeadline = null;

        await listing.save();

        // Send winner notification
        await handleWinnerSelection(listingId, highestBid._id.toString());

        console.log(`🏆 Highest bidder selected as winner for listing: ${listingId} (no platinum bidders accepted)`);

        return { action: 'winnerSelected', winnerBidId: highestBid._id.toString() };
      } else {
        // No bids - just mark as ended
        listing.status = 'ended';
        listing.privateRoomStatus = 'not-triggered';
        listing.platinumBidderAcceptanceDeadline = null;
        await listing.save();

        console.log(`📦 Listing ended with no bids: ${listingId}`);

        return { action: 'endedNoBids' };
      }
    }
  } catch (error) {
    console.error('Error processing expired acceptance window:', error);
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
    console.log('⚠️  Scheduler already running');
    return;
  }

  ioInstance = io; // Store io instance for socket events

  console.log(`⏰ Starting auction end scheduler (checking every ${intervalMinutes} minute(s))`);

  // Check immediately on start
  checkEndedAuctions().catch(err => {
    console.error('Error in initial auction check:', err);
  });

  // Then check at intervals
  checkInterval = setInterval(() => {
    checkEndedAuctions().catch(err => {
      console.error('Error in scheduled auction check:', err);
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
    console.log('⏰ Auction end scheduler stopped');
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  checkEndedAuctions,
  processExpiredAcceptanceWindow
};

