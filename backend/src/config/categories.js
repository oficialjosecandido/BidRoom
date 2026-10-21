'use strict';

/**
 * The canonical top-level category slugs.
 *
 * This list used to be copy-pasted in four places (the Listing enum, two admin
 * route handlers and adminListingService). Adding a category meant finding all
 * four, and missing one produced a category sellers could hold but admins could
 * not filter or assign. Import from here instead.
 *
 * Slugs are permanent: they are stored on every Listing and in the category
 * follow records, so renaming one needs a migration. Display names live in the
 * i18n bundles under addListing.categories.*, never here.
 */
const CATEGORY_IDS = [
  'archaeology',
  'art',
  'books',
  'collectibles',
  'comics',
  'electronics',
  'fashion',
  'home-garden',
  'jewelry',
  'music-film',
  'real-estate',
  'sports',
  'vehicles',
  'wine-spirits',
];

/**
 * Categories that cannot be given away, with the reason kept next to the rule.
 * A giveaway is not a sale, so the duties that make these awkward are not the
 * ones the sale flow already answers.
 */
const GIVEAWAY_EXCLUDED = {
  vehicles: 'transfer, registration and prize-tax obligations',
  'real-estate': 'transfer, registration and prize-tax obligations',
  'wine-spirits': 'age verification and excise duty on alcohol',
};

function isValidCategory(slug) {
  return CATEGORY_IDS.includes(slug);
}

/** Normalises user input ("Home Garden", " VEHICLES ") to a slug. */
function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
}

module.exports = {
  CATEGORY_IDS,
  GIVEAWAY_EXCLUDED,
  isValidCategory,
  normalizeCategory,
};
