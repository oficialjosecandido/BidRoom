const SITE_NAME = 'BidRoom';

const CTA = { pt: 'Licite já', en: 'Bid Now' };

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

/** "[description snippet, max 120 chars] Licite já|Bid Now" */
function buildOgDescription(description, lang = 'en') {
  const cta = CTA[lang] ?? CTA.en;
  const raw = String(description || '').replace(/\s+/g, ' ').trim();
  if (!raw) return cta;
  const snippet = raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  return `${snippet} ${cta}`;
}

module.exports = {
  SITE_NAME,
  CTA: CTA.en,
  pickShareLocale,
  getLocalizedListingText,
  buildOgTitle,
  buildOgDescription,
};
