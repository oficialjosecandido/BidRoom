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
 * Send choose winner notification to seller (only when there are bids)
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
 * Send "item not sold" notification to seller when auction closed with no bids.
 * CTA: relist the item for another 7 days.
 */
async function sendAuctionNotSoldNotification(listing) {
  try {
    const seller = listing.seller && listing.seller._id
      ? await User.findById(listing.seller._id)
      : await User.findById(listing.seller);
    if (!seller || !seller.email) {
      console.error('Seller not found or has no email for listing:', listing._id);
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const relistUrl = `${frontendUrl}/listing/${listing.slug}`;
    const language = getUserLanguage(seller);

    const email = getEmailTemplate('auctionNotSold', language, {
      sellerName: `${seller.firstName} ${seller.lastName}`,
      listingTitle: listing.title,
      relistUrl
    });

    await sendEmail(seller.email, email.subject, email.html);
    console.log(`📧 Sent auction not sold (relist) notification to seller: ${seller.email}`);

    return { sent: true };
  } catch (error) {
    console.error('Error sending auction not sold notification:', error);
    throw error;
  }
}

/**
 * Send "you've been outbid" notification to a bidder (only if they opted in via notifyWhenOutbid)
 */
async function sendOutbidNotification(listing, bidderEmail, bidderName, previousBidAmount, newBidAmount) {
  try {
    if (!bidderEmail) return { sent: false, reason: 'no_email' };

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const previousBid = `$${Number(previousBidAmount).toFixed(2)}`;
    const newBid = `$${Number(newBidAmount).toFixed(2)}`;

    const email = getEmailTemplate('outbid', 'en', {
      bidderName: bidderName || bidderEmail.split('@')[0],
      listingTitle: listing.title,
      previousBid,
      newBid,
      listingUrl
    });

    await sendEmail(bidderEmail, email.subject, email.html);
    console.log(`📧 Sent outbid notification to: ${bidderEmail}`);
    return { sent: true };
  } catch (error) {
    console.error('Error sending outbid notification:', error);
    return { sent: false, error: error.message };
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
 * Send "create private room" notification to seller (auction ended, reserve met, private room enabled)
 */
async function sendCreatePrivateRoomNotification(listing) {
  try {
    const seller = listing.seller && listing.seller._id
      ? await User.findById(listing.seller._id)
      : await User.findById(listing.seller);
    if (!seller || !seller.email) {
      console.error('Seller not found or has no email for listing:', listing._id);
      return;
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const createPrivateRoomUrl = `${frontendUrl}/listing/${listing.slug}`;
    const finalBid = `$${Number(listing.currentPrice).toFixed(2)}`;
    const language = getUserLanguage(seller);
    const email = getEmailTemplate('createPrivateRoomNotification', language, {
      sellerName: `${seller.firstName} ${seller.lastName}`,
      listingTitle: listing.title,
      finalBid,
      createPrivateRoomUrl
    });
    await sendEmail(seller.email, email.subject, email.html);
    console.log(`📧 Sent create private room notification to seller: ${seller.email}`);
    return { sent: true };
  } catch (error) {
    console.error('Error sending create private room notification:', error);
    throw error;
  }
}

/**
 * Send "you were not invited to the private room" to bidders who bid but were not selected
 */
async function sendPrivateRoomNotInvitedToBidders(listing, invitedUserIds) {
  try {
    const bids = await Bid.find({ listing: listing._id })
      .populate('bidder', 'firstName lastName email')
      .lean();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const invitedSet = new Set(invitedUserIds.map(id => id.toString()));
    const notifiedEmails = new Set();
    const seller = listing.seller && listing.seller._id ? await User.findById(listing.seller._id) : await User.findById(listing.seller);
    const sellerEmail = (seller && seller.email) ? seller.email.toLowerCase() : '';

    for (const bid of bids) {
      let bidderId = null;
      let bidderEmail = null;
      let bidderName = 'Guest Bidder';
      if (bid.bidder) {
        bidderId = bid.bidder._id.toString();
        bidderEmail = (bid.bidder.email || '').toLowerCase();
        bidderName = `${bid.bidder.firstName || ''} ${bid.bidder.lastName || ''}`.trim() || bid.bidder.email?.split('@')[0] || 'Bidder';
      } else if (bid.bidderEmail) {
        bidderEmail = bid.bidderEmail.toLowerCase();
        bidderName = bid.bidderEmail.split('@')[0];
      }
      if (!bidderEmail || notifiedEmails.has(bidderEmail) || bidderEmail === sellerEmail) continue;
      if (bidderId && invitedSet.has(bidderId)) continue;

      notifiedEmails.add(bidderEmail);
      const user = bid.bidder ? await User.findById(bid.bidder._id) : null;
      const language = getUserLanguage(user);
      const email = getEmailTemplate('privateRoomNotInvited', language, {
        bidderName,
        listingTitle: listing.title,
        listingUrl
      });
      try {
        await sendEmail(bidderEmail, email.subject, email.html);
        console.log(`📧 Sent private room not invited to ${bidderEmail}`);
      } catch (err) {
        console.error(`Failed to send private room not invited to ${bidderEmail}:`, err.message);
      }
    }
    return { notified: notifiedEmails.size };
  } catch (error) {
    console.error('Error sending private room not invited notifications:', error);
    throw error;
  }
}

/**
 * Send platinum bidder invitation emails. Each invitee must accept within 30 min or lose their seat.
 * listing must have platinumBidderInvitations populated with bidder and invitationToken.
 */
async function sendPlatinumBidderInvitations(listing) {
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/private-room/auction/${listing._id}`;
    const endDate = listing.privateRoomEndDate
      ? new Date(listing.privateRoomEndDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    const currentPrice = listing.currentPrice != null ? Number(listing.currentPrice).toFixed(2) : '0.00';
    const invitations = listing.platinumBidderInvitations || [];

    for (const inv of invitations) {
      const user = inv.bidder && inv.bidder._id ? await User.findById(inv.bidder._id) : null;
      if (!user || !user.email || !inv.invitationToken) continue;
      const acceptInvitationUrl = `${frontendUrl}/private-room/invitation/accept?token=${encodeURIComponent(inv.invitationToken)}&listingId=${listing._id}`;
      const language = getUserLanguage(user);
      const bidderName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email?.split('@')[0] || 'Bidder';
      const email = getEmailTemplate('platinumBidderInvitation', language, {
        bidderName,
        listingTitle: listing.title,
        listingUrl,
        acceptInvitationUrl,
        currentPrice,
        endDate
      });
      try {
        await sendEmail(user.email, email.subject, email.html);
        console.log(`📧 Sent platinum bidder invitation to ${user.email}`);
      } catch (err) {
        console.error(`Failed to send platinum invitation to ${user.email}:`, err.message);
      }
    }
    return { sent: true };
  } catch (error) {
    console.error('Error sending platinum bidder invitations:', error);
    throw error;
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

    const bidCount = await Bid.countDocuments({ listing: listingId });
    const hasBids = bidCount > 0;
    const reserveMet = listing.reservePrice == null || listing.currentPrice >= listing.reservePrice;

    // Private room enabled, has bids, reserve met → seller chooses guests after end (eligible flow). Seller has 1 hour to create room.
    if (listing.allowPrivateRoom && hasBids && reserveMet) {
      const deadline = new Date();
      deadline.setHours(deadline.getHours() + 1);

      await Listing.findByIdAndUpdate(listingId, {
        $set: {
          status: 'ended',
          privateRoomStatus: 'eligible',
          winnerSelectionDeadline: deadline
        }
      }, { runValidators: false });

      const listingForNotify = await Listing.findById(listingId)
        .populate('seller', 'firstName lastName email');
      if (!listingForNotify) throw new Error('Listing not found');

      await sendCreatePrivateRoomNotification(listingForNotify);
      console.log(`✅ Auction ended (private room eligible) for listing: ${listingId}. Seller notified to create room and invite 2–5 bidders.`);

      return {
        listingId,
        notified: true,
        hasBids: true,
        privateRoomEligible: true
      };
    }

    // Regular auction end: choose winner or not sold
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + 24);
    await Listing.findByIdAndUpdate(listingId, {
      $set: { status: 'ended', winnerSelectionDeadline: deadline }
    }, { runValidators: false });

    const listingForNotify = await Listing.findById(listingId)
      .populate('seller', 'firstName lastName email');
    if (!listingForNotify) throw new Error('Listing not found');

    const highestBid = await Bid.findOne({ listing: listingId })
      .sort({ amount: -1 })
      .populate('bidder', 'firstName lastName email')
      .lean();

    if (highestBid) {
      await sendAuctionClosedNotifications(listingForNotify, highestBid._id);
      await sendChooseWinnerNotification(listingForNotify);
    } else {
      await sendAuctionNotSoldNotification(listingForNotify);
    }

    console.log(`✅ Auction end notifications sent for listing: ${listingId}`);

    return {
      listingId,
      notified: true,
      hasBids: !!highestBid
    };
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

    // Store winner in listing (update only these fields to avoid full document validation)
    await Listing.findByIdAndUpdate(listingId, {
      $set: {
        winner: winnerBid.bidder ? winnerBid.bidder._id : null,
        winnerBid: winnerBidId,
        winnerSelectedAt: new Date()
      }
    }, { runValidators: false });

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
  sendAuctionNotSoldNotification,
  sendCreatePrivateRoomNotification,
  sendPrivateRoomNotInvitedToBidders,
  sendPlatinumBidderInvitations,
  sendOutbidNotification,
  sendWinnerNotification,
  sendFirstBidNotification
};

