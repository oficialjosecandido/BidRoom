/**
 * Scheduled openings.
 *
 * A seller can set an opening date in the future. The listing is created as
 * `active` so that it is visible, shareable and indexable from the start, and
 * `startDate` alone decides whether it takes bids yet. Keeping the status as
 * `active` means every listing query, sitemap and social post keeps working
 * untouched; the gate lives in the few places that accept money or bids.
 *
 * The auction's duration counts from the opening, so `endDate` is derived from
 * `startDate`, never from the creation time.
 */

/** A seller cannot park a listing on the site forever before it opens. */
const MAX_SCHEDULE_DAYS = 30;

/**
 * An opening this close to now is treated as "open immediately": the seller is
 * filling in a form, and a start a few seconds out would otherwise create a
 * listing that is briefly closed for no reason.
 */
const MIN_SCHEDULE_LEAD_MS = 60 * 1000;

class ListingScheduleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ListingScheduleError';
    this.statusCode = 400;
    this.code = 'invalid_schedule';
  }
}

/**
 * Validates a seller-supplied opening date.
 *
 * @returns {Date|null} the opening date, or null when the listing opens now
 * @throws {ListingScheduleError} when the date is unusable
 */
function parseScheduledStart(value, now = new Date()) {
  if (value === undefined || value === null || value === '') return null;

  const start = new Date(value);
  if (Number.isNaN(start.getTime())) {
    throw new ListingScheduleError('The opening date is not a valid date.');
  }

  if (start.getTime() - now.getTime() <= MIN_SCHEDULE_LEAD_MS) {
    if (start.getTime() < now.getTime() - MIN_SCHEDULE_LEAD_MS) {
      throw new ListingScheduleError('The opening date is in the past.');
    }
    return null;
  }

  const maxStart = now.getTime() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;
  if (start.getTime() > maxStart) {
    throw new ListingScheduleError(`An auction can open at most ${MAX_SCHEDULE_DAYS} days from now.`);
  }

  return start;
}

/** True while the listing is waiting for its opening date. */
function isScheduled(listing, now = new Date()) {
  const start = listing?.startDate;
  if (!start) return false;
  return new Date(start).getTime() > now.getTime();
}

/**
 * The refusal to send when someone tries to bid, offer or buy before the
 * opening. Returns null while the listing is open, so callers can write
 * `const blocked = scheduleBlock(listing); if (blocked) return res.status(400).json(blocked);`
 */
function scheduleBlock(listing, now = new Date()) {
  if (!isScheduled(listing, now)) return null;
  const opensAt = new Date(listing.startDate);
  return {
    error: 'listing_not_open',
    message: `This listing opens on ${opensAt.toISOString()}. Nothing can be bid, offered or bought before then.`,
    opensAt: opensAt.toISOString()
  };
}

module.exports = {
  MAX_SCHEDULE_DAYS,
  MIN_SCHEDULE_LEAD_MS,
  ListingScheduleError,
  parseScheduledStart,
  isScheduled,
  scheduleBlock
};
