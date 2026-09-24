/**
 * Phone numbers in E.164, which is the only shape Stripe accepts for
 * `individual.phone`.
 *
 * Sellers never typed a phone number for payouts — the ones we hold were typed
 * for MBWay or for a trader's public contact details, with no format enforced.
 * So a stored number is "912 345 678" as often as "+351912345678", and Stripe
 * rejects everything but the latter.
 *
 * The seller's country makes the national forms resolvable rather than guessed:
 * a number typed by someone with a Portuguese address is a Portuguese number.
 * Where that reasoning does not hold — a country we have no dial code for, a
 * length that cannot be a phone number — this returns null, and the caller asks
 * the seller instead of sending Stripe something invented.
 */

/** Dial codes for every country in COUNTRY_CURRENCY, plus the EEA stragglers. */
const DIAL_CODES = {
  AT: '43', BE: '32', BG: '359', HR: '385', CY: '357', CZ: '420',
  DK: '45', EE: '372', FI: '358', FR: '33', DE: '49', GR: '30',
  HU: '36', IE: '353', IS: '354', IT: '39', LV: '371', LI: '423',
  LT: '370', LU: '352', MT: '356', NL: '31', NO: '47', PL: '48',
  PT: '351', RO: '40', SK: '421', SI: '386', ES: '34', SE: '46',
  CH: '41', GB: '44', US: '1', CA: '1', AU: '61', NZ: '64',
  MX: '52', BR: '55', SG: '65', HK: '852', JP: '81', IN: '91',
  ZA: '27'
};

/** E.164 allows at most 15 digits; below 7 nothing real is that short. */
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

/**
 * Shortest national subscriber number worth believing. Without this floor a
 * five-digit typo in a PT field becomes +35112345, which satisfies E.164's
 * minimum only because the dial code padded it out.
 */
const MIN_NATIONAL_DIGITS = 6;

function plausible(digits) {
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS;
}

/**
 * @param {unknown} raw   what the seller typed, whenever they typed it
 * @param {unknown} country ISO-2 of the seller's address
 * @returns {string|null} '+…' or null when it cannot be resolved honestly
 */
function normalizePhoneE164(raw, country) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  // Letters mean a word, not a number — "n/a", "none", an extension note.
  if (/[A-Za-z]/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // Already international: the caller told us the country code, so believe it
  // over the address — a seller living in PT may well hold a Spanish number.
  if (trimmed.startsWith('+')) {
    return plausible(digits) ? `+${digits}` : null;
  }
  if (digits.startsWith('00')) {
    const international = digits.slice(2);
    return plausible(international) ? `+${international}` : null;
  }

  const dial = DIAL_CODES[String(country ?? '').toUpperCase()];
  if (!dial) return null;

  // A leading zero here is a trunk prefix — dialled inside the country, never
  // part of the number itself. No country in the table has numbers that start
  // with 0, so dropping it is safe rather than merely usual.
  const national = digits.replace(/^0+/, '');
  if (national.length < MIN_NATIONAL_DIGITS) return null;

  const full = `${dial}${national}`;
  return plausible(full) ? `+${full}` : null;
}

module.exports = { normalizePhoneE164, DIAL_CODES };
