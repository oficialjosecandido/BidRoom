const SITE_NAME = 'BidRoom';

const CTA_BY_LANG = {
  en: 'Bid Now',
  pt: 'Licite já'
};

/** Pick en/pt from Accept-Language (WhatsApp often sends pt-PT). */
function pickShareLocale(acceptLanguage = '') {
  const primary = String(acceptLanguage).split(',')[0].trim().toLowerCase();
  if (primary.startsWith('pt')) return 'pt';
  if (primary.startsWith('en')) return 'en';
  return 'en';
}

function getLocalizedListingText(listing, lang) {
  const title =
    lang === 'en' && listing.titleEn ? listing.titleEn
    : lang === 'pt' && listing.titlePt ? listing.titlePt
    : listing.title;

  const description =
    lang === 'en' && listing.descriptionEn ? listing.descriptionEn
    : lang === 'pt' && listing.descriptionPt ? listing.descriptionPt
    : listing.description || '';

  return { title: title || '', description };
}

function buildOgTitle(title) {
  const t = String(title || '').trim();
  return t ? `${SITE_NAME} - ${t}` : SITE_NAME;
}

function buildOgDescription(description, lang = 'en') {
  const cta = CTA_BY_LANG[lang] || CTA_BY_LANG.en;
  const raw = String(description || '').replace(/\s+/g, ' ').trim();
  if (!raw) return cta;
  const snippet = raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  return `${snippet} ${cta}`;
}

module.exports = {
  SITE_NAME,
  CTA_BY_LANG,
  pickShareLocale,
  getLocalizedListingText,
  buildOgTitle,
  buildOgDescription
};
