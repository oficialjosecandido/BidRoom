const Bid = require('../models/Bid');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');
const User = require('../models/User');
const { sendEmail } = require('./emailService');
const { getEmailTemplate, getUserLanguage } = require('./emailTemplates');
const { createTransactionForListing, createTransactionForAcceptedOffer } = require('./transactionService');

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
 * Send offer confirmation email to the bidder who submitted an offer (best-offer auctions)
 */
async function sendOfferPlacedEmail(listing, offererEmail, offererName, offerAmount) {
  try {
    if (!offererEmail) return { sent: false, reason: 'no_email' };
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const formattedAmount = `$${Number(offerAmount).toFixed(2)}`;
    const email = getEmailTemplate('offerPlaced', 'en', {
      offererName: offererName || offererEmail.split('@')[0],
      listingTitle: listing.title,
      offerAmount: formattedAmount,
      listingUrl
    });
    await sendEmail(offererEmail, email.subject, email.html);
    console.log(`📧 Sent offer confirmation to: ${offererEmail}`);
    return { sent: true };
  } catch (error) {
    console.error('Error sending offer confirmation email:', error);
    return { sent: false, error: error.message };
  }
}

/**
 * Send "higher offer received" email to a bidder whose offer was exceeded (best-offer auctions)
 */
async function sendOfferOutbidEmail(listing, offererEmail, offererName, previousOfferAmount, newOfferAmount) {
  try {
    if (!offererEmail) return { sent: false, reason: 'no_email' };
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const previousOffer = `$${Number(previousOfferAmount).toFixed(2)}`;
    const newOffer = `$${Number(newOfferAmount).toFixed(2)}`;
    const email = getEmailTemplate('offerOutbid', 'en', {
      offererName: offererName || offererEmail.split('@')[0],
      listingTitle: listing.title,
      previousOffer,
      newOffer,
      listingUrl
    });
    await sendEmail(offererEmail, email.subject, email.html);
    console.log(`📧 Sent offer outbid notification to: ${offererEmail}`);
    return { sent: true };
  } catch (error) {
    console.error('Error sending offer outbid email:', error);
    return { sent: false, error: error.message };
  }
}

/**
 * Send "best-offer listing ended" notification to seller - review offers within 24h
 */
async function sendBestOfferEndedNotification(listing, offerCount) {
  try {
    const seller = listing.seller && listing.seller._id
      ? await User.findById(listing.seller._id)
      : await User.findById(listing.seller);
    if (!seller || !seller.email) {
      console.error('Seller not found or has no email for listing:', listing._id);
      return;
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}?tab=offers`;
    const language = getUserLanguage(seller);
    const email = getEmailTemplate('bestOfferEnded', language || 'en', {
      sellerName: `${seller.firstName} ${seller.lastName}`,
      listingTitle: listing.title,
      offerCount,
      listingUrl
    });
    await sendEmail(seller.email, email.subject, email.html);
    console.log(`📧 Sent best-offer ended notification to seller: ${seller.email}`);
    return { sent: true };
  } catch (error) {
    console.error('Error sending best-offer ended notification:', error);
    return { sent: false, error: error.message };
  }
}

/**
 * Send "private room closed - no acceptances" to seller when no invited bidders accepted in time.
 */
async function sendPrivateRoomClosedNoAcceptanceToSeller(listing) {
  try {
    const seller = listing.seller && listing.seller._id
      ? await User.findById(listing.seller._id)
      : await User.findById(listing.seller);
    if (!seller || !seller.email) {
      console.error('Seller not found or has no email for listing:', listing._id);
      return;
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const language = getUserLanguage(seller);
    const email = getEmailTemplate('privateRoomClosedNoAcceptanceSeller', language, {
      sellerName: `${seller.firstName || ''} ${seller.lastName || ''}`.trim() || 'Seller',
      listingTitle: listing.title,
      listingUrl
    });
    await sendEmail(seller.email, email.subject, email.html);
    console.log(`📧 Sent private room closed (no acceptances) notification to seller: ${seller.email}`);
    return { sent: true };
  } catch (error) {
    console.error('Error sending private room closed (no acceptances) to seller:', error);
    throw error;
  }
}

/**
 * Send "private room closed - no acceptances" to all invited bidders.
 */
async function sendPrivateRoomClosedNoAcceptanceToInvitedBuyers(listing) {
  try {
    const invitations = listing.platinumBidderInvitations || [];
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const seller = listing.seller && listing.seller._id ? await User.findById(listing.seller._id) : await User.findById(listing.seller);
    const sellerEmail = (seller && seller.email) ? seller.email.toLowerCase() : '';

    for (const inv of invitations) {
      const user = inv.bidder && inv.bidder._id ? await User.findById(inv.bidder._id) : null;
      if (!user || !user.email) continue;
      if (user.email.toLowerCase() === sellerEmail) continue;

      const language = getUserLanguage(user);
      const bidderName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email?.split('@')[0] || 'Bidder';
      const email = getEmailTemplate('privateRoomClosedNoAcceptanceInvited', language, {
        bidderName,
        listingTitle: listing.title,
        listingUrl
      });
      try {
        await sendEmail(user.email, email.subject, email.html);
        console.log(`📧 Sent private room closed (no acceptances) to invited buyer: ${user.email}`);
      } catch (err) {
        console.error(`Failed to send private room closed to ${user.email}:`, err.message);
      }
    }
    return { sent: true };
  } catch (error) {
    console.error('Error sending private room closed (no acceptances) to invited buyers:', error);
    throw error;
  }
}

/**
 * Handle private room closed due to no one accepting the invitation.
 * Sets status=ended, privateRoomStatus=ended, no winner. Sends email + in-app to seller and invited buyers.
 */
async function handlePrivateRoomClosedNoAcceptance(listingId, io = null) {
  try {
    const listing = await Listing.findById(listingId)
      .populate('seller', 'firstName lastName email')
      .populate('platinumBidderInvitations.bidder', 'firstName lastName email');

    if (!listing) throw new Error('Listing not found');
    if (listing.privateRoomStatus !== 'invited') {
      console.log(`Listing ${listingId} private room not in invited state, skip.`);
      return { processed: false };
    }

    const now = new Date();

    await Listing.findByIdAndUpdate(listingId, {
      $set: {
        status: 'ended',
        privateRoomStatus: 'ended',
        endDate: now
      }
    }, { runValidators: false });

    const listingForNotify = await Listing.findById(listingId)
      .populate('seller', 'firstName lastName email')
      .populate('platinumBidderInvitations.bidder', 'firstName lastName email');

    if (!listingForNotify) throw new Error('Listing not found after update');

    await sendPrivateRoomClosedNoAcceptanceToSeller(listingForNotify);
    await sendPrivateRoomClosedNoAcceptanceToInvitedBuyers(listingForNotify);

    const { notifyPrivateRoomClosedNoAcceptanceSeller, notifyPrivateRoomClosedNoAcceptanceInvited, emitNewNotificationToUser } = require('./notificationService');
    const sellerUserId = listingForNotify.seller?._id?.toString?.() || listingForNotify.seller?.toString?.();
    if (sellerUserId) {
      await notifyPrivateRoomClosedNoAcceptanceSeller({
        listingSlug: listingForNotify.slug,
        listingTitle: listingForNotify.title,
        sellerUserId
      }).catch(err => console.error('Seller notification:', err));
      if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
    }

    const invitations = listingForNotify.platinumBidderInvitations || [];
    for (const inv of invitations) {
      const bidder = inv.bidder && inv.bidder._id ? await User.findById(inv.bidder._id) : null;
      if (!bidder) continue;
      const bidderUserId = bidder._id.toString();
      await notifyPrivateRoomClosedNoAcceptanceInvited({
        listingSlug: listingForNotify.slug,
        listingTitle: listingForNotify.title,
        bidderUserId
      }).catch(err => console.error('Invited buyer notification:', err));
      if (io) emitNewNotificationToUser(io, bidderUserId).catch(() => {});
    }

    if (io) {
      io.to(`listing:${listingId}`).emit('listing-update', {
        listingId: listingId.toString(),
        privateRoomStatus: 'ended',
        status: 'ended',
        endDate: now
      });
      io.to(`private-room:${listingId}`).emit('listing-update', {
        listingId: listingId.toString(),
        privateRoomStatus: 'ended',
        status: 'ended',
        endDate: now
      });
    }

    return { processed: true };
  } catch (error) {
    console.error('Error handling private room closed (no acceptances):', error);
    throw error;
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
 * Send platinum bidder invitation emails. Each invitee must accept within 15 min or lose their seat; room starts automatically after that.
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
      const endDateDisplay = endDate || 'After 15-min acceptance window';
      const email = getEmailTemplate('platinumBidderInvitation', language, {
        bidderName,
        listingTitle: listing.title,
        listingUrl,
        acceptInvitationUrl,
        currentPrice,
        endDate: endDateDisplay
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
 * @param {string} listingId
 * @param {object} [io] - Socket.io instance for real-time updates (optional)
 */
async function handleAuctionEnd(listingId, io = null) {
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

    // Best Offer: when listing closes with exactly one offer at or above minimum → auto-accept
    if (listing.auctionFormat === 'best-offer') {
      const offers = await Offer.find({ listing: listingId, status: 'pending' }).lean();
      const minimumOfferPrice = listing.minimumOfferPrice ?? 0;

      if (offers.length === 1) {
        const singleOffer = await Offer.findById(offers[0]._id).populate('listing').populate('offerer', 'firstName lastName email');
        if (singleOffer && singleOffer.amount >= minimumOfferPrice) {
          singleOffer.status = 'accepted';
          singleOffer.respondedAt = new Date();
          singleOffer.sellerResponse = 'Offer automatically accepted (met minimum price)';
          singleOffer.listing.status = 'ended';
          singleOffer.listing.currentPrice = singleOffer.amount;
          await Promise.all([singleOffer.save(), singleOffer.listing.save()]);

          if (singleOffer.offerer) {
            await createTransactionForAcceptedOffer(listingId.toString(), singleOffer._id.toString()).catch(err =>
              console.error('Transaction create for auto-accepted offer:', err.message)
            );
          }

          if (io) {
            const { formatOfferForSocket } = require('../utils/offerFormat');
            const populated = await Offer.findById(singleOffer._id).populate('offerer', 'firstName lastName email emailVerified').lean();
            io.to(`listing:${listingId}`).emit('offer-update', {
              listingId: listingId.toString(),
              offer: formatOfferForSocket(populated),
              listingStatus: 'ended'
            });
          }

          console.log(`✅ Best-offer listing ${listingId} auto-accepted single offer ($${singleOffer.amount} >= minimum $${minimumOfferPrice})`);
          return { listingId, notified: true, bestOfferAutoAccepted: true };
        }
      }

      // One offer below minimum, or multiple offers → just end listing; seller accepts/declines manually
      await Listing.findByIdAndUpdate(listingId, { $set: { status: 'ended' } }, { runValidators: false });
      console.log(`✅ Best-offer listing ${listingId} ended. ${offers.length} offer(s); seller may accept/decline manually.`);
      return { listingId, notified: true, bestOfferEnded: true };
    }

    const bidCount = await Bid.countDocuments({ listing: listingId });
    const hasBids = bidCount > 0;
    const reserveMet = listing.reservePrice == null || listing.currentPrice >= listing.reservePrice;

    // Count unique authenticated bidders (private room requires 2–5 to invite; only registered bidders eligible)
    const distinctBidders = await Bid.distinct('bidder', {
      listing: listingId,
      bidder: { $exists: true, $ne: null }
    });
    const authenticatedBidderCount = distinctBidders.filter(id => id != null).length;

    // Private room enabled, has bids, reserve met, AND at least 2 authenticated bidders → seller creates room.
    // If fewer than 2 authenticated bidders, we cannot create a private room → treat as regular auction, auto-select winner.
    if (listing.allowPrivateRoom && hasBids && reserveMet && authenticatedBidderCount >= 2) {
      const deadline = new Date();
      deadline.setHours(deadline.getHours() + 1);

      await Listing.findByIdAndUpdate(listingId, {
        $set: {
          status: 'ended',
          privateRoomStatus: 'eligible',
          winnerSelectionDeadline: deadline
        }
      }, { runValidators: false });

      // Emit so clients with the page open get the Create Private Room button
      if (io) {
        io.to(`listing:${listingId}`).emit('listing-update', {
          listingId: listingId.toString(),
          status: 'ended',
          privateRoomStatus: 'eligible',
          winnerSelectionDeadline: deadline.toISOString(),
          currentPrice: listing.currentPrice,
          bidCount
        });
      }

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

    // Regular auction end (no private room): highest bid wins automatically
    const highestBid = await Bid.findOne({ listing: listingId })
      .sort({ amount: -1 })
      .populate('bidder', 'firstName lastName email')
      .lean();

    // Auto-select winner when: has bids, highest bidder is authenticated (reserve not used; bids already met minimum)
    const canAutoSelect = highestBid && highestBid.bidder;

    if (canAutoSelect) {
      const now = new Date();
      await Listing.findByIdAndUpdate(listingId, {
        $set: {
          status: 'ended',
          winner: highestBid.bidder._id,
          winnerBid: highestBid._id,
          winnerSelectedAt: now
        }
      }, { runValidators: false });

      const listingForNotify = await Listing.findById(listingId)
        .populate('seller', 'firstName lastName email');
      if (!listingForNotify) throw new Error('Listing not found');

      await sendWinnerNotification(listingForNotify, highestBid);
      await sendAuctionClosedNotifications(listingForNotify, highestBid._id);
      await createTransactionForListing(listingId).catch(err =>
        console.error('Transaction create for auto-winner:', err.message)
      );

      const { notifySellerWinnerSelected, notifyBuyerAuctionWon, emitNewNotificationToUser } = require('./notificationService');
      const winnerName = highestBid.bidder ? `${highestBid.bidder.firstName} ${highestBid.bidder.lastName}`.trim() : (highestBid.bidderEmail || 'A bidder').split('@')[0];
      const sellerUserId = listingForNotify.seller?._id?.toString?.() || listingForNotify.seller?.toString?.();
      const buyerUserId = highestBid.bidder?._id?.toString?.() || highestBid.bidder?.toString?.();
      if (sellerUserId) {
        await notifySellerWinnerSelected({
          listingSlug: listingForNotify.slug,
          listingTitle: listingForNotify.title,
          winnerName,
          winningAmount: highestBid.amount,
          commissionRate: listingForNotify.commissionRate ?? 0.005,
          shippingCost: listingForNotify.shippingCost ?? 0,
          shippingOption: listingForNotify.shippingOption ?? 'flat-rate',
          sellerUserId
        }).catch(err => console.error('Seller winner notification:', err));
        if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
      }
      if (buyerUserId) {
        await notifyBuyerAuctionWon({
          listingSlug: listingForNotify.slug,
          listingTitle: listingForNotify.title,
          winningAmount: highestBid.amount,
          buyerUserId
        }).catch(err => console.error('Buyer won notification:', err));
        if (io) emitNewNotificationToUser(io, buyerUserId).catch(() => {});
      }

      if (io) {
        io.to(`listing:${listingId}`).emit('listing-update', {
          listingId: listingId.toString(),
          status: 'ended',
          winner: highestBid.bidder._id.toString(),
          currentPrice: listing.currentPrice,
          bidCount
        });
      }

      console.log(`✅ Auction ended: highest bidder auto-selected as winner for listing: ${listingId}`);

      return {
        listingId,
        notified: true,
        hasBids: true,
        autoWinnerSelected: true
      };
    }

    // Reserve not met, no bids, or guest highest bidder → seller must choose winner
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + 24);
    await Listing.findByIdAndUpdate(listingId, {
      $set: { status: 'ended', winnerSelectionDeadline: deadline }
    }, { runValidators: false });

    if (io) {
      io.to(`listing:${listingId}`).emit('listing-update', {
        listingId: listingId.toString(),
        status: 'ended',
        winnerSelectionDeadline: deadline.toISOString(),
        currentPrice: listing.currentPrice,
        bidCount
      });
    }

    const listingForNotify = await Listing.findById(listingId)
      .populate('seller', 'firstName lastName email');
    if (!listingForNotify) throw new Error('Listing not found');

    if (highestBid) {
      await sendAuctionClosedNotifications(listingForNotify, null); // Don't exclude winner - seller will choose
      await sendChooseWinnerNotification(listingForNotify);
    } else {
      await sendAuctionNotSoldNotification(listingForNotify);
    }

    console.log(`✅ Auction end: choose-winner flow for listing: ${listingId} (reserve not met or guest bidder)`);

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
 * @param {string} listingId
 * @param {string} winnerBidId
 * @param {object} [io] - Socket.io instance for in-app notification badge
 */
async function handleWinnerSelection(listingId, winnerBidId, io = null) {
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

    // Send winner email
    await sendWinnerNotification(listing, winnerBid);

    // Create transaction so buyer/seller can track payment and shipping
    await createTransactionForListing(listingId).catch(err => console.error('Transaction create:', err.message));

    // In-app notifications for seller and winner
    const { notifySellerWinnerSelected, notifyBuyerAuctionWon, emitNewNotificationToUser } = require('./notificationService');
    const winnerName = winnerBid.bidder ? `${winnerBid.bidder.firstName} ${winnerBid.bidder.lastName}`.trim() : (winnerBid.bidderEmail || 'A bidder').split('@')[0];
    const sellerUserId = listing.seller?._id?.toString?.() || listing.seller?.toString?.();
    const buyerUserId = winnerBid.bidder?._id?.toString?.() || winnerBid.bidder?.toString?.();
    if (sellerUserId) {
      await notifySellerWinnerSelected({
        listingSlug: listing.slug,
        listingTitle: listing.title,
        winnerName,
        winningAmount: winnerBid.amount,
        commissionRate: listing.commissionRate ?? 0.005,
        shippingCost: listing.shippingCost ?? 0,
        shippingOption: listing.shippingOption ?? 'flat-rate',
        sellerUserId
      }).catch(err => console.error('Seller winner notification:', err));
      if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
    }
    if (buyerUserId) {
      await notifyBuyerAuctionWon({
        listingSlug: listing.slug,
        listingTitle: listing.title,
        winningAmount: winnerBid.amount,
        shippingCost: listing.shippingCost ?? 0,
        shippingOption: listing.shippingOption ?? 'flat-rate',
        buyerUserId
      }).catch(err => console.error('Buyer won notification:', err));
      if (io) emitNewNotificationToUser(io, buyerUserId).catch(() => {});
    }

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

/**
 * Send private room end notifications: winner gets "You won" (highest bid not outbid 60s),
 * other bidders get "Private room closed - another bidder won".
 */
async function sendPrivateRoomEndNotifications(listing, highestBid = null) {
  try {
    const Bid = require('../models/Bid');
    const bids = await Bid.find({ listing: listing._id })
      .populate('bidder', 'firstName lastName email')
      .lean();

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;
    const paymentUrl = `${frontendUrl}/listing/${listing.slug}/payment`;
    const finalBid = `$${listing.currentPrice.toFixed(2)}`;
    const notifiedEmails = new Set();
    const sellerEmail = listing.seller?.email?.toLowerCase() || '';

    // Send winner email (private room: highest bid not outbid for 60s)
    if (highestBid) {
      let winnerEmail = null;
      let winnerName = 'Guest Bidder';
      if (highestBid.bidder?.email) {
        winnerEmail = highestBid.bidder.email.toLowerCase();
        winnerName = `${highestBid.bidder.firstName} ${highestBid.bidder.lastName}`;
      } else if (highestBid.bidderEmail) {
        winnerEmail = highestBid.bidderEmail.toLowerCase();
        winnerName = highestBid.bidderEmail.split('@')[0];
      }
      if (winnerEmail && winnerEmail !== sellerEmail) {
        const user = highestBid.bidder?._id ? await User.findById(highestBid.bidder._id) : null;
        const language = getUserLanguage(user);
        const winningBid = `$${highestBid.amount.toFixed(2)}`;
        const email = getEmailTemplate('privateRoomWinner', language, {
          winnerName,
          listingTitle: listing.title,
          winningBid,
          paymentUrl
        });
        await sendEmail(winnerEmail, email.subject, email.html);
        notifiedEmails.add(winnerEmail);
        console.log(`📧 Sent private room winner notification to ${winnerEmail}`);
      }
    }

    // Send "not winner" email to all other bidders
    for (const bid of bids) {
      let bidderEmail = null;
      let bidderName = 'Guest Bidder';
      if (bid.bidder?.email) {
        bidderEmail = bid.bidder.email.toLowerCase();
        bidderName = `${bid.bidder.firstName} ${bid.bidder.lastName}`;
      } else if (bid.bidderEmail) {
        bidderEmail = bid.bidderEmail.toLowerCase();
        bidderName = bid.bidderEmail.split('@')[0];
      }
      if (!bidderEmail || notifiedEmails.has(bidderEmail) || bidderEmail === sellerEmail) continue;
      notifiedEmails.add(bidderEmail);

      const user = bid.bidder?._id ? await User.findById(bid.bidder._id) : null;
      const language = getUserLanguage(user);
      const email = getEmailTemplate('privateRoomNotWinner', language, {
        bidderName,
        listingTitle: listing.title,
        finalBid,
        listingUrl
      });
      await sendEmail(bidderEmail, email.subject, email.html);
      console.log(`📧 Sent private room not-winner notification to ${bidderEmail}`);
    }

    return { notified: notifiedEmails.size };
  } catch (error) {
    console.error('Error sending private room end notifications:', error);
    throw error;
  }
}

/**
 * Close an active private room when its end time has passed. Sets status to ended,
 * sets winner to highest bid (not outbid for 60s), sends private-room winner/not-winner
 * emails and choose-winner to seller; optionally emits socket event.
 */
async function handlePrivateRoomEnd(listingId, io = null) {
  try {
    const listing = await Listing.findById(listingId)
      .populate('seller', 'firstName lastName email');
    if (!listing) throw new Error('Listing not found');
    if (listing.privateRoomStatus !== 'active') {
      console.log(`Listing ${listingId} private room not active, skip.`);
      return { processed: false };
    }

    const Bid = require('../models/Bid');
    const highestBid = await Bid.findOne({ listing: listingId })
      .sort({ amount: -1 })
      .populate('bidder', 'firstName lastName email')
      .lean();

    const now = new Date();
    const deadline = new Date(now);
    deadline.setHours(deadline.getHours() + 24);

    const updatePayload = {
      status: 'ended',
      privateRoomStatus: 'ended',
      endDate: now,
      winnerSelectionDeadline: deadline
    };
    if (highestBid) {
      updatePayload.winner = highestBid.bidder?._id || highestBid.bidder;
      updatePayload.winnerBid = highestBid._id;
      updatePayload.winnerSelectedAt = now;
    }

    await Listing.findByIdAndUpdate(listingId, { $set: updatePayload }, { runValidators: false });

    const listingForNotify = await Listing.findById(listingId).populate('seller', 'firstName lastName email');
    if (!listingForNotify) throw new Error('Listing not found after update');

    try {
      await sendPrivateRoomEndNotifications(listingForNotify, highestBid);
      await sendChooseWinnerNotification(listingForNotify);
      // Create transaction when there is a winner (authenticated bidder)
      if (highestBid && (highestBid.bidder?._id || highestBid.bidder)) {
        await createTransactionForListing(listingId).catch(err => console.error('Transaction create:', err.message));
      }
      console.log(`✅ Private room ended and notifications sent for listing: ${listingId}`);
    } catch (notificationError) {
      console.error('Error sending private room end notifications:', notificationError);
    }

    if (io) {
      io.to(`listing:${listingId}`).emit('listing-update', {
        listingId: listingId.toString(),
        privateRoomStatus: 'ended',
        status: 'ended',
        endDate: now
      });
      io.to(`private-room:${listingId}`).emit('listing-update', {
        listingId: listingId.toString(),
        privateRoomStatus: 'ended',
        status: 'ended',
        endDate: now
      });
    }

    return { processed: true };
  } catch (error) {
    console.error('Error handling private room end:', error);
    throw error;
  }
}

module.exports = {
  handleAuctionEnd,
  handlePrivateRoomEnd,
  handlePrivateRoomClosedNoAcceptance,
  handleWinnerSelection,
  sendAuctionClosedNotifications,
  sendChooseWinnerNotification,
  sendPrivateRoomEndNotifications,
  sendAuctionNotSoldNotification,
  sendCreatePrivateRoomNotification,
  sendPrivateRoomNotInvitedToBidders,
  sendPlatinumBidderInvitations,
  sendOutbidNotification,
  sendWinnerNotification,
  sendFirstBidNotification,
  sendOfferPlacedEmail,
  sendOfferOutbidEmail
};

