const {
  MAX_SCHEDULE_DAYS,
  ListingScheduleError,
  parseScheduledStart,
  isScheduled,
  scheduleBlock
} = require('../src/utils/listingSchedule');

const NOW = new Date('2026-09-22T10:00:00.000Z');
const inDays = d => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

describe('listingSchedule', () => {
  describe('parseScheduledStart', () => {
    it('treats a missing or immediate start as "opens now"', () => {
      expect(parseScheduledStart(undefined, NOW)).toBeNull();
      expect(parseScheduledStart('', NOW)).toBeNull();
      // The seller submitted the form a moment ago — not worth a closed listing.
      expect(parseScheduledStart(new Date(NOW.getTime() + 20 * 1000), NOW)).toBeNull();
    });

    it('accepts a future opening and keeps the exact instant', () => {
      const start = parseScheduledStart('2026-09-25T18:30:00.000Z', NOW);
      expect(start.toISOString()).toBe('2026-09-25T18:30:00.000Z');
    });

    it('refuses a date in the past, a nonsense date, and one too far ahead', () => {
      expect(() => parseScheduledStart(inDays(-2), NOW)).toThrow(ListingScheduleError);
      expect(() => parseScheduledStart('next tuesday', NOW)).toThrow(/not a valid date/);
      expect(() => parseScheduledStart(inDays(MAX_SCHEDULE_DAYS + 1), NOW))
        .toThrow(new RegExp(`${MAX_SCHEDULE_DAYS} days`));
      expect(parseScheduledStart(inDays(MAX_SCHEDULE_DAYS - 0.1), NOW)).not.toBeNull();
    });
  });

  describe('isScheduled / scheduleBlock', () => {
    it('blocks bids until the opening, then lets them through', () => {
      const listing = { startDate: inDays(3) };
      expect(isScheduled(listing, NOW)).toBe(true);

      const blocked = scheduleBlock(listing, NOW);
      expect(blocked).toMatchObject({ error: 'listing_not_open', opensAt: inDays(3).toISOString() });

      const afterOpening = new Date(inDays(3).getTime() + 1000);
      expect(isScheduled(listing, afterOpening)).toBe(false);
      expect(scheduleBlock(listing, afterOpening)).toBeNull();
    });

    it('leaves a listing that started in the past alone', () => {
      expect(scheduleBlock({ startDate: inDays(-1) }, NOW)).toBeNull();
      expect(scheduleBlock({}, NOW)).toBeNull();
    });
  });
});
