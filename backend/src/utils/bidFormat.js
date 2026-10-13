/**
 * The single place where a Bid becomes something a client is allowed to see.
 *
 * Every field here is listed on purpose. The code this replaces spread the
 * whole lean document (`...bid`) into the response, which made each field on
 * the model public the moment somebody added it to the schema — nobody decided
 * to publish `ipAddress`, `deviceFingerprint`, `fraudFlags` or `isFlagged`,
 * they simply arrived. Worst of all was `maxBid`, the proxy-bidding ceiling:
 * publishing it on an unauthenticated endpoint tells every rival exactly what
 * they have to beat, which is the end of the auction as an auction.
 *
 * No branch of this function returns an email address, to anyone — not to the
 * seller, not to the winner, not over a socket. Buyer contact details live in
 * Nexus, which reads the database directly.
 */
const crypto = require('crypto');

/**
 * Stable pseudonym for a bidder, so the UI can group a guest's bids together
 * (highest bid per person, "you are the top bidder") without being told who
 * they are.
 *
 * HMAC rather than a plain hash: a bare sha256 of an email is reversible in
 * practice, because an attacker who suspects an address can simply hash it and
 * compare. Scoped per listing so the same person is not linkable across
 * auctions. Follows hashReviewerIp in routes/reviews.js.
 */
const BIDDER_KEY_SECRET = process.env.BIDDER_KEY_SECRET || process.env.JWT_SECRET || 'bidroom-bidder-key-salt';

function bidderKey(bid, listingId) {
  const identity = bid?.bidder?._id
    ? `u:${bid.bidder._id.toString()}`
    : (bid?.bidderEmail ? `e:${String(bid.bidderEmail).trim().toLowerCase()}` : null);
  if (!identity) return null;
  return crypto
    .createHmac('sha256', BIDDER_KEY_SECRET)
    .update(`${String(listingId)}|${identity}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * A name safe to show to somebody else.
 *
 * The codebase was full of `email.split('@')[0]` as a display-name fallback,
 * which is not a pseudonym: for most people the local part is their actual name,
 * and it hands over enough to guess the address at a known provider. Anything a
 * seller, a rival bidder, or a notification shows about a *different* person
 * goes through here.
 *
 * @param {object|null} person   a Customer-shaped object (firstName/lastName)
 * @param {string} [fallback]    what to say when there is no real name
 */
function publicDisplayName(person, fallback = 'A bidder') {
  if (person && (person.firstName || person.lastName)) {
    const name = `${person.firstName || ''} ${person.lastName || ''}`.trim();
    if (name) return name;
  }
  return fallback;
}

/**
 * How to address somebody in an email we are sending *to them*.
 *
 * Returns '' when there is no name on file, and every template that takes a
 * name slot guards it (`Hello{{#if bidderName}} <strong>…</strong>{{/if}},`),
 * so an empty string degrades to a clean "Olá," / "Hola," / "Bonjour,".
 *
 * Two things it exists to stop, both of which were live:
 *
 *   `email.split('@')[0]`, which greeted people as "Olá joao.silva92" — not a
 *   privacy leak, since the address is their own, but it reads like a database
 *   dump and tells the recipient we never learned their name.
 *
 *   English literals — 'Guest Bidder', 'Bidder', 'Anonymous' — which landed
 *   inside Portuguese, Spanish and French emails as "Olá Bidder,". A fallback
 *   that is not translated cannot be a fallback in a four-language product, and
 *   the empty string needs no translation.
 *
 * For a name shown to somebody *else*, use publicDisplayName instead: the
 * question there is what a third party may see, not what we call you.
 */
function greetingName(person) {
  return publicDisplayName(person, '');
}

/**
 * Initials, which is all formatBidPublic publishes about a person.
 *
 * 'G' for a guest bid placed without an account: there is no name to take
 * initials from, and the email is not a source of one.
 */
function displayInitials(bid) {
  const b = bid?.bidder;
  if (b && (b.firstName || b.lastName)) {
    const first = (b.firstName || '').charAt(0);
    const last = (b.lastName || '').charAt(0);
    return `${first}${last}`.toUpperCase() || 'G';
  }
  return 'G';
}

/**
 * @param {object} bid              a lean Bid, optionally with `bidder` populated
 * @param {object} [extra]          computed values the caller already has
 * @param {number} [extra.buyerTrustTier]
 * @param {number|null} [extra.buyerScore]
 * @param {number} [extra.buyerReviewCount]
 */
function formatBidPublic(bid, extra = {}) {
  if (!bid) return null;
  const b = bid.bidder;
  const listingId = bid.listing && bid.listing.toString ? bid.listing.toString() : String(bid.listing);

  return {
    _id: bid._id && bid._id.toString ? bid._id.toString() : String(bid._id),
    listing: listingId,
    amount: bid.amount,
    bidType: bid.bidType,
    createdAt: bid.createdAt ? new Date(bid.createdAt).toISOString() : null,

    // Identity, reduced to what a rival bidder legitimately needs to see:
    // initials, and nothing else. This used to publish the bidder's full first
    // and last name on an unauthenticated endpoint, for every bid, which turns
    // any live listing into a list of named people who have money and want this
    // category of thing — handed over in bulk, no account required. Initials
    // keep the history legible as a sequence of distinct people without being
    // the roster.
    //
    // bidderId stays: it is an opaque ObjectId the private room needs to match
    // bids to invitees, and the viewer's own id arrives separately as
    // viewerBidderId so the client can mark its own rows.
    bidderId: b && b._id ? b._id.toString() : null,
    bidderKey: bidderKey(bid, listingId),
    bidderInitials: displayInitials(bid),
    isAuthenticated: !!b,
    bidderVerified: b ? !!b.emailVerified : false,

    // Reputation signals, already public on the profile page.
    reputationScore: b?.reputationScore ?? null,
    buyerTrustTier: extra.buyerTrustTier ?? 0,
    buyerScore: extra.buyerScore ?? null,
    buyerReviewCount: extra.buyerReviewCount ?? 0
  };
}

module.exports = { formatBidPublic, bidderKey, publicDisplayName, greetingName, displayInitials };
