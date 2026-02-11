/**
 * Auction End Scheduler
 * Checks for ended auctions and sends notifications
 */

const Listing = require('../models/Listing');
const { handleAuctionEnd, handlePrivateRoomEnd } = require('./auctionNotificationService');

let checkInterval = null;
let ioInstance = null;

/**
 * Check for ended auctions and process them (regular auctions and private rooms past their end time)
 */
async function checkEndedAuctions() {
  try {
    const now = new Date();
    let processed = 0;

    // 0) Private rooms in 'invited' state past acceptance deadline → auto-start the room (15 min passed)
    const PRIVATE_ROOM_EXTEND_MS = 60 * 1000;
    const invitedPastDeadline = await Listing.find({
      status: 'active',
      privateRoomStatus: 'invited',
      platinumBidderAcceptanceDeadline: { $lte: now }
    });
    for (const listing of invitedPastDeadline) {
      try {
        const roomEndDate = new Date(now.getTime() + PRIVATE_ROOM_EXTEND_MS);
        await Listing.findByIdAndUpdate(listing._id, {
          $set: {
            privateRoomStatus: 'active',
            privateRoomEndDate: roomEndDate,
            privateRoomLastBidTime: now,
            endDate: roomEndDate
          }
        }, { runValidators: false });
        processed++;
        console.log(`✅ Auto-started private room (15 min passed): ${listing._id} - ${listing.title}`);
      } catch (error) {
        console.error(`❌ Error auto-starting private room ${listing._id}:`, error.message);
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
        await handleAuctionEnd(listing._id, ioInstance);
        processed++;
        console.log(`✅ Processed ended auction: ${listing._id} - ${listing.title}`);
      } catch (error) {
        console.error(`❌ Error processing auction ${listing._id}:`, error.message);
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
        await handlePrivateRoomEnd(listing._id, ioInstance);
        processed++;
        console.log(`✅ Closed private room (time expired): ${listing._id} - ${listing.title}`);
      } catch (error) {
        console.error(`❌ Error closing private room ${listing._id}:`, error.message);
      }
    }

    if (invitedPastDeadline.length > 0 || endedAuctions.length > 0 || endedPrivateRooms.length > 0) {
      console.log(`🔍 Processed ${processed} (auto-started / ended auction(s) / private room(s))`);
    }

    return { processed };
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

