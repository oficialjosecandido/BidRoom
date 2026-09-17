/**
 * Per-language title and description of a listing.
 *
 * `title` and `description` are the fallback the site shows when the reader's
 * language has no text of its own: the first language filled, Portuguese first.
 * A legacy `title`/`description` with no per-language copy is taken as
 * Portuguese.
 */

const LISTING_LOCALES = ['Pt', 'En', 'Fr', 'Es'];

const LISTING_LOCALE_FIELDS = [
  ...LISTING_LOCALES.map(l => `title${l}`),
  ...LISTING_LOCALES.map(l => `description${l}`)
];

function cleanText(value) {
  return value == null ? '' : String(value).trim();
}

function nullableText(value) {
  const clean = cleanText(value);
  return clean || null;
}

function normalizeListingLocaleFields(body = {}) {
  const legacyTitle = cleanText(body.title);
  const legacyDescription = cleanText(body.description);
  const titlePt = cleanText(body.titlePt) || legacyTitle;
  const titleEn = cleanText(body.titleEn);
  const titleFr = cleanText(body.titleFr);
  const titleEs = cleanText(body.titleEs);
  const descriptionPt = cleanText(body.descriptionPt) || legacyDescription;
  const descriptionEn = cleanText(body.descriptionEn);
  const descriptionFr = cleanText(body.descriptionFr);
  const descriptionEs = cleanText(body.descriptionEs);

  return {
    title: titlePt || titleEn || titleFr || titleEs || legacyTitle,
    description: descriptionPt || descriptionEn || descriptionFr || descriptionEs || legacyDescription,
    titlePt: nullableText(titlePt),
    titleEn: nullableText(titleEn),
    titleFr: nullableText(titleFr),
    titleEs: nullableText(titleEs),
    descriptionPt: nullableText(descriptionPt),
    descriptionEn: nullableText(descriptionEn),
    descriptionFr: nullableText(descriptionFr),
    descriptionEs: nullableText(descriptionEs),
  };
}

module.exports = { LISTING_LOCALES, LISTING_LOCALE_FIELDS, normalizeListingLocaleFields };
