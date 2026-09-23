/**
 * Automatic "live auctions" block for newsletters.
 *
 * The newsletter used to be hand-written: an admin pasted six listings into the
 * Nexus composer, one per category, in four languages. By the time a campaign
 * actually went out some of those auctions had ended, and every edition cost an
 * hour of copy-paste.
 *
 * This module picks the auctions and renders the block instead. The composer
 * only carries the placeholder `{{AUCTIONS}}`; it is expanded per recipient
 * language *at send time*, so a campaign written on Monday and sent on Friday
 * still shows auctions that are open on Friday.
 *
 * The cards are rendered in the BidRoom email palette — dark #111 and gold
 * #C9A84C, the same tokens as `utils/bidroomEmailLayout` — because the block is
 * dropped inside a branded newsletter shell and must not read as another brand.
 */

const Listing = require('../models/Listing');
const { publicBaseUrl } = require('../utils/publicUrls');
const logger = require('../utils/logger');

/** Languages the composer supports. Same list as the campaign pipeline. */
const NEWSLETTER_LANGUAGES = ['pt', 'en', 'es', 'fr'];

/** What an admin types in the composer to get the generated block. */
const AUCTIONS_PLACEHOLDER = '{{AUCTIONS}}';

/** Both spellings are accepted — the Portuguese one is what admins reach for. */
const PLACEHOLDER_PATTERN = /\{\{\s*(?:AUCTIONS|LEILOES|LEILÕES)\s*\}\}/gi;

/** The giveaway band, which renders nothing when none is running. */
const GIVEAWAY_PLACEHOLDER = '{{GIVEAWAY}}';
const GIVEAWAY_PATTERN = /\{\{\s*(?:GIVEAWAY|PASSATEMPO|SORTEIO)\s*\}\}/gi;

const DEFAULT_AUCTION_COUNT = 6;

/** The BidRoom email palette — same tokens as `utils/bidroomEmailLayout`. */
const COLORS = {
  gold: '#C9A84C',
  goldDark: '#a8872e',
  goldBorder: '#e8d9a8',
  text: '#111111',
  muted: '#64748b',
  white: '#ffffff',
  dark: '#111111',
  cream: '#F0EDE8',
  creamMuted: 'rgba(240,237,232,0.72)'
};

/** Categories, in the order they are offered a slot when scores tie. */
const CATEGORY_ORDER = [
  'jewelry',
  'art',
  'collectibles',
  'electronics',
  'home-garden',
  'vehicles',
  'real-estate'
];

const CATEGORY_LABELS = {
  pt: {
    electronics: 'Eletrónica',
    'home-garden': 'Casa e Jardim',
    art: 'Arte',
    collectibles: 'Colecionáveis',
    jewelry: 'Joalharia',
    'real-estate': 'Imóveis',
    vehicles: 'Automóveis e Veículos'
  },
  en: {
    electronics: 'Electronics',
    'home-garden': 'Home & Garden',
    art: 'Art',
    collectibles: 'Collectibles',
    jewelry: 'Jewelry',
    'real-estate': 'Real Estate',
    vehicles: 'Vehicles'
  },
  es: {
    electronics: 'Electrónica',
    'home-garden': 'Hogar y Jardín',
    art: 'Arte',
    collectibles: 'Coleccionables',
    jewelry: 'Joyería',
    'real-estate': 'Inmuebles',
    vehicles: 'Vehículos'
  },
  fr: {
    electronics: 'Électronique',
    'home-garden': 'Maison et Jardin',
    art: 'Art',
    collectibles: 'Collection',
    jewelry: 'Bijouterie',
    'real-estate': 'Immobilier',
    vehicles: 'Véhicules'
  }
};

const STRINGS = {
  pt: {
    bestOffer: 'Melhor Oferta',
    currentBid: 'Licitação atual',
    startingBid: 'Base de licitação',
    endsToday: 'Termina hoje',
    endsInDays: d => `Termina em ${d} dia${d === 1 ? '' : 's'}`,
    giveawayLabel: 'Giveaway',
    giveawayFree: 'Participação gratuita',
    giveawayEntries: n => `${n} participaç${n === 1 ? 'ão' : 'ões'}`,
    giveawayCta: 'Participar grátis'
  },
  en: {
    bestOffer: 'Best Offer',
    currentBid: 'Current bid',
    startingBid: 'Starting bid',
    endsToday: 'Ends today',
    endsInDays: d => `Ends in ${d} day${d === 1 ? '' : 's'}`,
    giveawayLabel: 'Giveaway',
    giveawayFree: 'Free to enter',
    giveawayEntries: n => `${n} ${n === 1 ? 'entry' : 'entries'}`,
    giveawayCta: 'Enter for free'
  },
  es: {
    bestOffer: 'Mejor Oferta',
    currentBid: 'Puja actual',
    startingBid: 'Puja inicial',
    endsToday: 'Termina hoy',
    endsInDays: d => `Termina en ${d} día${d === 1 ? '' : 's'}`,
    giveawayLabel: 'Sorteo',
    giveawayFree: 'Participación gratuita',
    giveawayEntries: n => `${n} participaci${n === 1 ? 'ón' : 'ones'}`,
    giveawayCta: 'Participar gratis'
  },
  fr: {
    bestOffer: 'Meilleure Offre',
    currentBid: 'Enchère actuelle',
    startingBid: 'Mise à prix',
    endsToday: 'Se termine aujourd’hui',
    endsInDays: d => `Se termine dans ${d} jour${d === 1 ? '' : 's'}`,
    giveawayLabel: 'Tirage au sort',
    giveawayFree: 'Participation gratuite',
    giveawayEntries: n => `${n} participation${n === 1 ? '' : 's'}`,
    giveawayCta: 'Participer gratuitement'
  }
};

/**
 * Prices are grouped by hand rather than with `Intl`.
 *
 * CLDR leaves four-digit numbers ungrouped in pt-PT ("1350 €"), which is
 * correct but not what the newsletter design asks for: it shows "€ 1.350", with
 * the symbol first and every thousand separated. Non-breaking spaces keep a
 * price from wrapping in the middle.
 */
const NUMBER_FORMATS = {
  pt: { group: '.', decimal: ',' },
  es: { group: '.', decimal: ',' },
  fr: { group: '\u00a0', decimal: ',' },
  en: { group: ',', decimal: '.' }
};

function lang(language) {
  return NEWSLETTER_LANGUAGES.includes(language) ? language : 'pt';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The listing title in the recipient's language.
 *
 * Sellers are not required to translate, so this falls back through Portuguese
 * and English before the legacy single-language `title`.
 */
function localizedTitle(listing, language) {
  const l = lang(language);
  const key = `title${l.charAt(0).toUpperCase()}${l.slice(1)}`;
  const candidates = [listing[key], listing.titlePt, listing.titleEn, listing.title];
  const found = candidates.find(v => String(v || '').trim());
  return String(found || '').trim();
}

function categoryLabel(category, language) {
  const table = CATEGORY_LABELS[lang(language)] || CATEGORY_LABELS.pt;
  return table[category] || CATEGORY_LABELS.pt[category] || '';
}

function formatPrice(amount, language) {
  const format = NUMBER_FORMATS[lang(language)];
  const cents = Math.round((Number(amount) || 0) * 100);
  const whole = Math.floor(cents / 100);
  const remainder = cents % 100;

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, format.group);
  // Whole euros lose the ",00" — the design shows "€ 1.350", not "€ 1.350,00".
  const body = remainder
    ? `${grouped}${format.decimal}${String(remainder).padStart(2, '0')}`
    : grouped;

  return `€\u00a0${body}`;
}

/** What the price under the title actually means, which depends on the format. */
function priceCaption(listing, language) {
  const s = STRINGS[lang(language)];
  if (listing.auctionFormat === 'best-offer') return s.bestOffer;
  return (listing.bidCount || 0) > 0 ? s.currentBid : s.startingBid;
}

function endsCaption(listing, language, now) {
  const s = STRINGS[lang(language)];
  const ms = new Date(listing.endDate).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days <= 1 ? s.endsToday : s.endsInDays(days);
}

/**
 * A thumbnail an email client can actually load.
 *
 * Blob storage serves the original, so the image is scaled by the width/height
 * attributes on the tag rather than by the URL. Listings created without photos
 * carry a via.placeholder.com "No Image" URL, which must never reach an inbox —
 * a card without a usable photo drops the thumbnail cell instead.
 */
function thumbnailUrl(listing) {
  return (listing.images || []).find(
    url => /^https:\/\//i.test(url) && !/placeholder\.com/i.test(url)
  ) || null;
}

function listingUrl(listing, baseUrl) {
  return `${baseUrl}/listing/${listing.slug}`;
}

/**
 * Auctions that are open for business right now.
 *
 * `status: 'active'` is not enough on its own any more: a seller can schedule an
 * opening date, and a scheduled listing is already `active` and visible while
 * its `startDate` is still in the future. Featuring one in a newsletter would
 * send readers to a page where they cannot bid, so the opening must have passed.
 */
function eligibleAuctionsQuery(now) {
  return {
    status: 'active',
    saleFormat: 'auction',
    startDate: { $lte: now },
    endDate: { $gt: now },
    'images.0': { $exists: true }
  };
}

const FEATURED_FIELDS =
  'slug category images currentPrice startingPrice bidCount viewCount endDate auctionFormat ' +
  'title titlePt titleEn titleFr titleEs';

/** No price on a giveaway — the entry count is what the band has to show. */
const GIVEAWAY_FIELDS =
  'slug category images endDate giveaway.entryCount title titlePt titleEn titleFr titleEs';

/**
 * Most interesting first: auctions people are already bidding on, then ones
 * people are looking at, then the newest. Used to choose which listing
 * represents its category, and which fill the leftover slots.
 */
function sortByInterest(a, b) {
  return (
    (b.bidCount || 0) - (a.bidCount || 0) ||
    (b.viewCount || 0) - (a.viewCount || 0) ||
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

/**
 * Picks the auctions for one edition: the strongest listing from each category
 * first, so the block reads as a tour of the marketplace rather than six
 * watches, then the next best overall to fill any empty slots.
 *
 * Returns fewer than `limit` — possibly none — when the site does not have
 * enough open auctions. Callers decide whether that is worth sending.
 */
async function pickFeaturedAuctions({ limit = DEFAULT_AUCTION_COUNT, now = new Date() } = {}) {
  const candidates = await Listing.find(eligibleAuctionsQuery(now), FEATURED_FIELDS)
    .sort({ bidCount: -1, viewCount: -1, createdAt: -1 })
    .limit(200)
    .lean();

  if (candidates.length === 0) return [];

  const byCategory = new Map();
  for (const listing of candidates) {
    if (!byCategory.has(listing.category)) byCategory.set(listing.category, []);
    byCategory.get(listing.category).push(listing);
  }
  for (const list of byCategory.values()) list.sort(sortByInterest);

  const orderedCategories = [...byCategory.keys()].sort((a, b) => {
    const best = sortByInterest(byCategory.get(a)[0], byCategory.get(b)[0]);
    if (best !== 0) return best;
    return CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b);
  });

  const picked = [];
  const used = new Set();
  for (const category of orderedCategories) {
    if (picked.length >= limit) break;
    const listing = byCategory.get(category)[0];
    picked.push(listing);
    used.add(String(listing._id));
  }

  for (const listing of candidates) {
    if (picked.length >= limit) break;
    if (used.has(String(listing._id))) continue;
    picked.push(listing);
    used.add(String(listing._id));
  }

  return picked;
}

/**
 * The giveaway running right now, if there is one.
 *
 * A giveaway is open under exactly the same conditions as an auction — active,
 * opened, not yet over — plus one of its own: the draw must not have happened.
 * `drawnAt` is set the moment a winner comes out, and an already-drawn giveaway
 * is a results page, not an invitation.
 *
 * At most one is featured: the weekly template has a single giveaway band, and
 * the one closing soonest is the one readers still have to act on.
 */
async function pickActiveGiveaway({ now = new Date() } = {}) {
  const [giveaway] = await Listing.find(
    {
      status: 'active',
      saleFormat: 'giveaway',
      startDate: { $lte: now },
      endDate: { $gt: now },
      'giveaway.drawnAt': null
    },
    GIVEAWAY_FIELDS
  )
    .sort({ endDate: 1 })
    .limit(1)
    .lean();

  return giveaway || null;
}

/**
 * The giveaway band: dark, so it reads as a different kind of offer than the
 * white auction cards stacked under it, with the one button in the body of the
 * email because entering is a single free action and the whole point of the band.
 */
function renderGiveawayBlock(giveaway, language, { baseUrl = publicBaseUrl(), now = new Date() } = {}) {
  if (!giveaway) return '';

  const l = lang(language);
  const s = STRINGS[l];
  const url = listingUrl(giveaway, baseUrl);
  const title = escapeHtml(localizedTitle(giveaway, l));
  const image = thumbnailUrl(giveaway);
  const ends = endsCaption(giveaway, l, now);
  const entries = Number(giveaway.giveaway?.entryCount) || 0;

  // Entry counts only persuade once there are some — "0 participações" argues
  // the other way.
  const meta = [entries > 0 ? s.giveawayEntries(entries) : s.giveawayFree, ends]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');

  const thumbCell = image
    ? `<td width="124" valign="top" style="width:124px;">
            <a href="${url}"><img src="${escapeHtml(image)}" width="124" height="124" alt="${title}" style="display:block;width:124px;height:124px;object-fit:cover;border:0;"></a>
          </td>`
    : '';

  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 18px;border:1px solid ${COLORS.gold};border-radius:10px;overflow:hidden;background:${COLORS.dark};">
        <tr>
          ${thumbCell}
          <td valign="middle" style="padding:16px 18px;background:${COLORS.dark};">
            <div style="font-size:11px;font-weight:700;color:${COLORS.gold};text-transform:uppercase;letter-spacing:0.09em;margin-bottom:5px;">${escapeHtml(s.giveawayLabel)}</div>
            <a href="${url}" style="text-decoration:none;color:${COLORS.cream};font-size:15px;font-weight:700;line-height:1.35;">${title}</a>
            <div style="margin-top:4px;font-size:12px;color:${COLORS.creamMuted};">${meta}</div>
            <table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:12px;">
              <tr>
                <td style="background:${COLORS.gold};border-radius:999px;">
                  <a href="${url}" style="display:inline-block;padding:9px 22px;color:${COLORS.dark};font-weight:700;text-decoration:none;font-size:13px;">${escapeHtml(s.giveawayCta)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
}

/**
 * One card: a square thumbnail flush to the left edge, then category, title,
 * price and what the price means. The whole title is the link — the card has no
 * button of its own, so six of them stack without turning into a wall of CTAs.
 */
function renderAuctionCard(listing, language, { baseUrl, now }) {
  const l = lang(language);
  const url = listingUrl(listing, baseUrl);
  const title = escapeHtml(localizedTitle(listing, l));
  const image = thumbnailUrl(listing);
  const price = formatPrice(listing.currentPrice || listing.startingPrice || 0, l);
  const ends = endsCaption(listing, l, now);

  const thumbCell = image
    ? `<td width="124" valign="top" style="width:124px;">
            <a href="${url}"><img src="${escapeHtml(image)}" width="124" height="124" alt="${title}" style="display:block;width:124px;height:124px;object-fit:cover;border:0;"></a>
          </td>`
    : '';

  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 14px;border:1px solid ${COLORS.goldBorder};border-radius:10px;overflow:hidden;background:${COLORS.white};">
        <tr>
          ${thumbCell}
          <td valign="middle" style="padding:16px 18px;background:${COLORS.white};">
            <div style="font-size:11px;font-weight:700;color:${COLORS.goldDark};text-transform:uppercase;letter-spacing:0.09em;margin-bottom:5px;">${escapeHtml(categoryLabel(listing.category, l))}</div>
            <a href="${url}" style="text-decoration:none;color:${COLORS.text};font-size:15px;font-weight:700;line-height:1.35;">${title}</a>
            <div style="margin-top:7px;font-size:17px;font-weight:700;color:${COLORS.goldDark};">${escapeHtml(price)}</div>
            <div style="margin-top:3px;font-size:12px;color:${COLORS.muted};">${escapeHtml(priceCaption(listing, l))}${ends ? ` · ${escapeHtml(ends)}` : ''}</div>
          </td>
        </tr>
      </table>`;
}

/**
 * The cards, and only the cards.
 *
 * The "browse all" button belongs to the newsletter shell around this block, so
 * it sits below the last card exactly once however the block is placed. An
 * empty list renders nothing, so an expansion never leaves a stray heading.
 */
function renderAuctionsBlock(listings, language, { baseUrl = publicBaseUrl(), now = new Date() } = {}) {
  if (!Array.isArray(listings) || listings.length === 0) return '';
  const l = lang(language);
  return listings.map(listing => renderAuctionCard(listing, l, { baseUrl, now })).join('\n      ');
}

function hasAuctionPlaceholder(html) {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return PLACEHOLDER_PATTERN.test(String(html || ''));
}

function hasGiveawayPlaceholder(html) {
  GIVEAWAY_PATTERN.lastIndex = 0;
  return GIVEAWAY_PATTERN.test(String(html || ''));
}

/** Swaps every placeholder in one HTML body for the rendered block. */
function expandAuctionPlaceholders(html, language, listings, options = {}) {
  const source = String(html || '');
  if (!hasAuctionPlaceholder(source)) return source;
  const block = renderAuctionsBlock(listings, language, options);
  return source.replace(PLACEHOLDER_PATTERN, () => block);
}

/**
 * Swaps the giveaway placeholder for the band — or for nothing, which is the
 * normal case: most weeks there is no giveaway running and the template must
 * close over the gap without leaving an empty frame behind.
 */
function expandGiveawayPlaceholders(html, language, giveaway, options = {}) {
  const source = String(html || '');
  if (!hasGiveawayPlaceholder(source)) return source;
  const block = renderGiveawayBlock(giveaway, language, options);
  return source.replace(GIVEAWAY_PATTERN, () => block);
}

/** Both blocks, in one pass over one language's HTML. */
function expandNewsletterBlocks(html, language, { listings = [], giveaway = null, baseUrl, now } = {}) {
  const options = { baseUrl, now };
  return expandGiveawayPlaceholders(
    expandAuctionPlaceholders(html, language, listings, options),
    language,
    giveaway,
    options
  );
}

/**
 * Expands both placeholders across a whole `{ pt: {subject, html}, ... }`
 * content object, choosing the auctions and the giveaway once so every language
 * shows the same ones.
 *
 * Each query is skipped when no language asks for that block, so a plain
 * hand-written campaign still goes out without touching the database.
 */
async function expandCampaignContent(content, { limit = DEFAULT_AUCTION_COUNT, now = new Date() } = {}) {
  const languages = Object.keys(content || {});
  const needsAuctions = languages.some(l => hasAuctionPlaceholder(content[l]?.html));
  const needsGiveaway = languages.some(l => hasGiveawayPlaceholder(content[l]?.html));
  if (!needsAuctions && !needsGiveaway) return { content, listings: [], giveaway: null };

  const [listings, giveaway] = await Promise.all([
    needsAuctions ? pickFeaturedAuctions({ limit, now }) : [],
    needsGiveaway ? pickActiveGiveaway({ now }) : null
  ]);

  if (needsAuctions && listings.length === 0) {
    logger.warn('[newsletter] {{AUCTIONS}} used but no open auction qualifies — block rendered empty.');
  }

  const baseUrl = publicBaseUrl();
  const expanded = {};
  for (const l of languages) {
    const variant = content[l];
    expanded[l] = {
      ...variant,
      html: expandNewsletterBlocks(variant?.html, l, { listings, giveaway, baseUrl, now })
    };
  }
  return { content: expanded, listings, giveaway };
}

module.exports = {
  NEWSLETTER_LANGUAGES,
  AUCTIONS_PLACEHOLDER,
  GIVEAWAY_PLACEHOLDER,
  DEFAULT_AUCTION_COUNT,
  pickFeaturedAuctions,
  pickActiveGiveaway,
  renderAuctionCard,
  renderAuctionsBlock,
  renderGiveawayBlock,
  expandAuctionPlaceholders,
  expandGiveawayPlaceholders,
  expandNewsletterBlocks,
  expandCampaignContent,
  hasAuctionPlaceholder,
  hasGiveawayPlaceholder,
  localizedTitle,
  categoryLabel,
  formatPrice
};
