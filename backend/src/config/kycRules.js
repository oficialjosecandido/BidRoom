/**
 * The value above which identity verification is required, in one place.
 *
 * It was written twice — routes/listings.js for the seller, routes/bids.js for
 * the bidder — and the two copies had drifted into three messages that all told
 * the user the limit was "$5,000". BidRoom prices everything in euros; there is
 * no dollar figure anywhere in the product. Nobody decided to quote dollars,
 * the literal was simply copied, and the number shown to a user was the wrong
 * currency of the right amount.
 *
 * The threshold itself is a legal judgement call, like the ones in
 * config/vehicleRules.js, so it is env-overridable without a deploy.
 *
 * Still English: these messages are returned by the API and rendered raw by the
 * frontend, which means a Portuguese, Spanish or French seller reads them in
 * English. Localising API messages is the same job as the notification
 * catalogue — an i18n key in the response instead of a sentence — and is not
 * done here.
 */

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Listings priced at or above this, and bids at or above it, need approved KYC. */
const KYC_THRESHOLD_EUR = envNumber('KYC_THRESHOLD_EUR', 5000);

/**
 * The threshold as it should appear in a sentence: "€5 000".
 *
 * pt-PT groups thousands with a no-break space, which is what the vehicle
 * ceiling message in services/vehicleComplianceService.js already renders.
 * `useGrouping: 'always'` is needed because the locale's default drops the
 * separator on a four-digit number — €5000 against €20 000 for the car cap,
 * two amounts formatted two ways in the same product.
 */
function kycThresholdLabel() {
  return `€${KYC_THRESHOLD_EUR.toLocaleString('pt-PT', { useGrouping: 'always' })}`;
}

module.exports = { KYC_THRESHOLD_EUR, kycThresholdLabel };
