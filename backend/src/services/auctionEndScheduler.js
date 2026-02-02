/**
 * Auction End Scheduler
 * Checks for ended auctions and sends notifications
 */

const Listing = require('../models/Listing');
const { handleAuctionEnd } = require('./auctionNotificationService');

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

    return { processed: endedAuctions.length };
  } catch (error) {
    console.error('Error checking ended auctions:', error);
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
  checkEndedAuctions
};

