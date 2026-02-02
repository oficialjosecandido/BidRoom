const Bid = require('../models/Bid');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { sendEmail } = require('./emailService');
const { getEmailTemplate, getUserLanguage } = require('./emailTemplates');

/**
 * Send auction closed notifications to all bidders (except winner and seller)
 */
async function sendAuctionClosedNotifications(listing, winnerBidId = null) {
  try {
    // Get all unique bidders (both authenticated and unauthenticated)
    const bids = await Bid.find({ listing: listing._id })
      .populate('bidder', 'firstName lastName email')
      .lean();

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const finalBid = `$${listing.currentPrice.toFixed(2)}`;

    // Get unique bidders (by user ID or email)
    const notifiedEmails = new Set();
    const sellerEmail = listing.seller.email?.toLowerCase() || '';

    for (const bid of bids) {
      let bidderEmail = null;
      let bidderName = 'Guest Bidder';

      if (bid.bidder) {
        bidderEmail = bid.bidder.email?.toLowerCase();
        bidderName = `${bid.bidder.firstName} ${bid.bidder.lastName}`;
      } else if (bid.bidderEmail) {
        bidderEmail = bid.bidderEmail.toLowerCase();
        bidderName = bid.bidderEmail.split('@')[0];
      }

      // Skip if no email, already notified, is seller, or is winner
      if (!bidderEmail || 
          notifiedEmails.has(bidderEmail) || 
          bidderEmail === sellerEmail ||
          (winnerBidId && bid._id.toString() === winnerBidId.toString())) {
        continue;
      }

      notifiedEmails.add(bidderEmail);

      // Get user for language preference
      const user = bid.bidder ? await User.findById(bid.bidder._id) : null;
      const language = getUserLanguage(user);

      // Get email template
      const email = getEmailTemplate('auctionClosed', language, {
        bidderName,
        listingTitle: listing.title,
        finalBid,
        listingUrl
      });

      // Send email
      try {
        await sendEmail(bidderEmail, email.subject, email.html);
        console.log(`📧 Sent auction closed notification to ${bidderEmail}`);
      } catch (error) {
        console.error(`❌ Failed to send email to ${bidderEmail}:`, error.message);
      }
    }

    return { notified: notifiedEmails.size };
  } catch (error) {
    console.error('Error sending auction closed notifications:', error);
    throw error;
  }
}

/**
 * Send choose winner notification to seller
 */
async function sendChooseWinnerNotification(listing) {
  try {
    const seller = await User.findById(listing.seller);
    if (!seller || !seller.email) {
      console.error('Seller not found or has no email for listing:', listing._id);
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const chooseWinnerUrl = `${frontendUrl}/listing/${listing.slug}/choose-winner`;
    const finalBid = `$${listing.currentPrice.toFixed(2)}`;
    const language = getUserLanguage(seller);

    const email = getEmailTemplate('chooseWinner', language, {
      sellerName: `${seller.firstName} ${seller.lastName}`,
      listingTitle: listing.title,
      finalBid,
      chooseWinnerUrl
    });

    await sendEmail(seller.email, email.subject, email.html);
    console.log(`📧 Sent choose winner notification to seller: ${seller.email}`);

    return { sent: true };
  } catch (error) {
    console.error('Error sending choose winner notification:', error);
    throw error;
  }
}

/**
 * Send winner notification
 */
async function sendWinnerNotification(listing, winnerBid) {
  try {
    let winnerEmail = null;
    let winnerName = 'Guest Bidder';

    if (winnerBid.bidder) {
      const winner = await User.findById(winnerBid.bidder);
      if (winner && winner.email) {
        winnerEmail = winner.email;
        winnerName = `${winner.firstName} ${winner.lastName}`;
      }
    } else if (winnerBid.bidderEmail) {
      winnerEmail = winnerBid.bidderEmail;
      winnerName = winnerBid.bidderEmail.split('@')[0];
    }

    if (!winnerEmail) {
      console.error('Winner has no email for bid:', winnerBid._id);
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const paymentUrl = `${frontendUrl}/listing/${listing.slug}/payment`;
    const winningBid = `$${winnerBid.amount.toFixed(2)}`;

    // Get user for language preference
    const user = winnerBid.bidder ? await User.findById(winnerBid.bidder) : null;
    const language = getUserLanguage(user);

    const email = getEmailTemplate('youWon', language, {
      winnerName,
      listingTitle: listing.title,
      winningBid,
      paymentUrl
    });

    await sendEmail(winnerEmail, email.subject, email.html);
    console.log(`📧 Sent winner notification to: ${winnerEmail}`);

    return { sent: true };
  } catch (error) {
    console.error('Error sending winner notification:', error);
    throw error;
  }
}

/**
 * Send first bid confirmation email
 */
async function sendFirstBidNotification(listing, bid, bidderEmail, bidderName) {
  try {
    if (!bidderEmail) {
      console.log('Skipping first bid notification - no email address');
      return { sent: false, reason: 'no_email' };
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const bidAmount = `$${bid.amount.toFixed(2)}`;
    
    // Format auction end date
    const endDate = listing.privateRoomStatus === 'active' && listing.privateRoomEndDate
      ? new Date(listing.privateRoomEndDate)
      : new Date(listing.endDate);
    const auctionEndDate = endDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Get user for language preference (if authenticated)
    let language = 'en';
    if (bid.bidder) {
      const user = await User.findById(bid.bidder);
      language = getUserLanguage(user);
    }

    const email = getEmailTemplate('firstBidPlaced', language, {
      bidderName,
      listingTitle: listing.title,
      bidAmount,
      auctionEndDate,
      listingUrl
    });

    await sendEmail(bidderEmail, email.subject, email.html);
    console.log(`📧 Sent first bid notification to: ${bidderEmail}`);

    return { sent: true };
  } catch (error) {
    console.error('Error sending first bid notification:', error);
    // Don't throw - this is a non-critical notification
    return { sent: false, error: error.message };
  }
}

/**
 * Handle auction end - send all notifications
 */
async function handleAuctionEnd(listingId) {
  try {
    const listing = await Listing.findById(listingId)
      .populate('seller', 'firstName lastName email');

    if (!listing) {
      throw new Error('Listing not found');
    }

    if (listing.status === 'ended') {
      console.log('Listing already marked as ended:', listingId);
      return;
    }

    // Check if private room is enabled and has platinum bidders - activate private room immediately (no acceptance window)
    if (listing.allowPrivateRoom && listing.platinumBidders && listing.platinumBidders.length > 0) {
      const now = new Date();
      const privateRoomEndDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

      listing.status = 'active'; // Keep active so platinum bidders can bid in private room
      listing.privateRoomStatus = 'active'; // Private room active immediately - platinum bidders can bid without accepting
      listing.privateRoomEndDate = privateRoomEndDate;
      listing.privateRoomLastBidTime = null;
      listing.endDate = privateRoomEndDate; // Extend end date for private room

      await listing.save();

      // Get highest bid for notifications
      const highestBid = await Bid.findOne({ listing: listingId })
        .sort({ amount: -1 })
        .populate('bidder', 'firstName lastName email')
        .lean();

      if (highestBid) {
        await sendAuctionClosedNotifications(listing, highestBid._id);
      } else {
        await sendAuctionClosedNotifications(listing);
      }

      await sendChooseWinnerNotification(listing);

      console.log(`🔒 Private room activated for listing: ${listingId}. Ends at ${privateRoomEndDate.toISOString()}`);
      console.log(`✅ Auction end notifications sent for listing: ${listingId}`);

      return {
        listingId,
        notified: true,
        hasBids: !!highestBid,
        privateRoomActive: true,
        privateRoomEndDate
      };
    } else {
      // Regular auction end (no private room)
      listing.status = 'ended';
      const deadline = new Date();
      deadline.setHours(deadline.getHours() + 24); // 24 hours from now
      listing.winnerSelectionDeadline = deadline;
      await listing.save();

      // Get highest bid (potential winner)
      const highestBid = await Bid.findOne({ listing: listingId })
        .sort({ amount: -1 })
        .populate('bidder', 'firstName lastName email')
        .lean();

      // Send notifications to all bidders (except winner and seller)
      if (highestBid) {
        await sendAuctionClosedNotifications(listing, highestBid._id);
      } else {
        await sendAuctionClosedNotifications(listing);
      }

      // Send notification to seller to choose winner
      await sendChooseWinnerNotification(listing);

      console.log(`✅ Auction end notifications sent for listing: ${listingId}`);

      return {
        listingId,
        notified: true,
        hasBids: !!highestBid
      };
    }
  } catch (error) {
    console.error('Error handling auction end:', error);
    throw error;
  }
}

/**
 * Handle winner selection by seller
 */
async function handleWinnerSelection(listingId, winnerBidId) {
  try {
    const listing = await Listing.findById(listingId)
      .populate('seller', 'firstName lastName email');

    if (!listing) {
      throw new Error('Listing not found');
    }

    const winnerBid = await Bid.findById(winnerBidId)
      .populate('bidder', 'firstName lastName email')
      .lean();

    if (!winnerBid) {
      throw new Error('Winner bid not found');
    }

    // Store winner information in listing
    listing.winner = winnerBid.bidder ? winnerBid.bidder._id : null;
    listing.winnerBid = winnerBidId;
    listing.winnerSelectedAt = new Date();
    await listing.save();

    // Send winner notification
    await sendWinnerNotification(listing, winnerBid);

    console.log(`✅ Winner selected and notified for listing: ${listingId}`);

    return {
      listingId,
      winnerBidId,
      notified: true
    };
  } catch (error) {
    console.error('Error handling winner selection:', error);
    throw error;
  }
}

module.exports = {
  handleAuctionEnd,
  handleWinnerSelection,
  sendAuctionClosedNotifications,
  sendChooseWinnerNotification,
  sendWinnerNotification,
  sendFirstBidNotification
};

