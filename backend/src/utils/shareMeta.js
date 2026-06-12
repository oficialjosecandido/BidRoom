const SITE_NAME = 'BidRoom';

/** CTA appended to every OG description — always English, always "Bid Now". */
const CTA = 'Bid Now';

/** Pick pt/en from Accept-Language (WhatsApp often sends pt-PT). */
function pickShareLocale(acceptLanguage = '') {
  const primary = String(acceptLanguage).split(',')[0].trim().toLowerCase();
  if (primary.startsWith('pt')) return 'pt';
  if (primary.startsWith('en')) return 'en';
  return 'en';
}

/**
 * Returns the best available title and description for the given locale.
 * Falls back to the base fields if the localised variants are empty.
 */
function getLocalizedListingText(listing, lang) {
  const title =
    (lang === 'en' && listing.titleEn)  ? listing.titleEn  :
    (lang === 'pt' && listing.titlePt)  ? listing.titlePt  :
    listing.title || '';

  const description =
    (lang === 'en' && listing.descriptionEn) ? listing.descriptionEn :
    (lang === 'pt' && listing.descriptionPt) ? listing.descriptionPt :
    listing.description || '';

  return { title, description };
}

/** "BidRoom - Rolex Submariner 5513" */
function buildOgTitle(title) {
  const t = String(title || '').trim();
  return t ? `${SITE_NAME} - ${t}` : SITE_NAME;
}

/**
 * "[description snippet, max 120 chars] Bid Now"
 *
 * Always ends with "Bid Now" regardless of language — it is a BidRoom brand
 * phrase and should be consistent across all share previews.
 */
function buildOgDescription(description) {
  const raw = String(description || '').replace(/\s+/g, ' ').trim();
  if (!raw) return CTA;
  const snippet = raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  return `${snippet} ${CTA}`;
}

module.exports = {
  SITE_NAME,
  CTA,
  pickShareLocale,
  getLocalizedListingText,
  buildOgTitle,
  buildOgDescription,
};
