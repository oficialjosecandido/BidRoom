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
 * The markup deliberately matches the existing newsletter preset (600px table,
 * navy #002366, Arial) rather than the gold transactional layout: the block is
 * dropped inside that email and must not look like a different brand.
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

const DEFAULT_AUCTION_COUNT = 6;

const COLORS = {
  navy: '#002366',
  text: '#111111',
  muted: '#666666',
  line: '#e5e7eb',
  white: '#ffffff'
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
    cta: 'Ver anúncio',
    endsToday: 'Termina hoje',
    endsInDays: d => `Termina em ${d} dia${d === 1 ? '' : 's'}`,
    browseAll: 'Ver todos os leilões'
  },
  en: {
    bestOffer: 'Best Offer',
    currentBid: 'Current bid',
    startingBid: 'Starting bid',
    cta: 'View listing',
    endsToday: 'Ends today',
    endsInDays: d => `Ends in ${d} day${d === 1 ? '' : 's'}`,
    browseAll: 'Browse all auctions'
  },
  es: {
    bestOffer: 'Mejor Oferta',
    currentBid: 'Puja actual',
    startingBid: 'Puja inicial',
    cta: 'Ver anuncio',
    endsToday: 'Termina hoy',
    endsInDays: d => `Termina en ${d} día${d === 1 ? '' : 's'}`,
    browseAll: 'Ver todas las subastas'
  },
  fr: {
    bestOffer: 'Meilleure Offre',
    currentBid: 'Enchère actuelle',
    startingBid: 'Mise à prix',
    cta: 'Voir l’annonce',
    endsToday: 'Se termine aujourd’hui',
    endsInDays: d => `Se termine dans ${d} jour${d === 1 ? '' : 's'}`,
    browseAll: 'Voir toutes les enchères'
  }
};

const PRICE_LOCALES = { pt: 'pt-PT', en: 'en-GB', es: 'es-ES', fr: 'fr-FR' };

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
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(PRICE_LOCALES[lang(language)], {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2
    }).format(value);
  } catch {
    return `€ ${value.toFixed(2)}`;
  }
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

/** One card: 120px thumbnail on the left, category / title / price / CTA on the right. */
function renderAuctionCard(listing, language, { baseUrl, now }) {
  const l = lang(language);
  const s = STRINGS[l];
  const url = listingUrl(listing, baseUrl);
  const title = escapeHtml(localizedTitle(listing, l));
  const image = thumbnailUrl(listing);
  const price = formatPrice(
    listing.currentPrice || listing.startingPrice || 0,
    l
  );
  const ends = endsCaption(listing, l, now);

  const thumbCell = image
    ? `<td width="120" valign="top" style="width:120px;background:${COLORS.white};">
            <a href="${url}"><img src="${escapeHtml(image)}" width="120" height="120" alt="${title}" style="display:block;width:120px;height:120px;object-fit:cover;border:0;"></a>
          </td>`
    : '';

  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 18px;border:1px solid ${COLORS.line};border-radius:8px;overflow:hidden;">
        <tr>
          ${thumbCell}
          <td valign="middle" style="padding:14px 16px;background:${COLORS.white};">
            <div style="font-size:11px;font-weight:700;color:${COLORS.navy};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${escapeHtml(categoryLabel(listing.category, l))}</div>
            <a href="${url}" style="text-decoration:none;color:${COLORS.text};font-size:15px;font-weight:700;line-height:1.35;">${title}</a>
            <div style="margin-top:6px;font-size:16px;font-weight:700;color:${COLORS.text};">${escapeHtml(price)}</div>
            <div style="margin-top:2px;font-size:12px;color:${COLORS.muted};">${escapeHtml(priceCaption(listing, l))}${ends ? ` · ${escapeHtml(ends)}` : ''}</div>
            <div style="margin-top:10px;"><a href="${url}" style="display:inline-block;background:${COLORS.navy};color:${COLORS.white};padding:8px 16px;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700;">${escapeHtml(s.cta)}</a></div>
          </td>
        </tr>
      </table>`;
}

/**
 * The whole block: the cards plus a "browse all" link. Returns '' for an empty
 * list so an expansion never leaves a stray heading behind.
 */
function renderAuctionsBlock(listings, language, { baseUrl = publicBaseUrl(), now = new Date() } = {}) {
  if (!Array.isArray(listings) || listings.length === 0) return '';
  const l = lang(language);
  const cards = listings.map(listing => renderAuctionCard(listing, l, { baseUrl, now })).join('\n      ');

  return `${cards}
      <div style="margin:4px 0 0;text-align:center;">
        <a href="${baseUrl}/listings" style="color:${COLORS.navy};font-size:13px;font-weight:700;text-decoration:underline;">${escapeHtml(STRINGS[l].browseAll)}</a>
      </div>`;
}

function hasAuctionPlaceholder(html) {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return PLACEHOLDER_PATTERN.test(String(html || ''));
}

/** Swaps every placeholder in one HTML body for the rendered block. */
function expandAuctionPlaceholders(html, language, listings, options = {}) {
  const source = String(html || '');
  if (!hasAuctionPlaceholder(source)) return source;
  const block = renderAuctionsBlock(listings, language, options);
  return source.replace(PLACEHOLDER_PATTERN, () => block);
}

/**
 * Expands the placeholder across a whole `{ pt: {subject, html}, ... }` content
 * object, picking the auctions once so every language shows the same six.
 *
 * Content without a placeholder is returned untouched and no query is run.
 */
async function expandCampaignContent(content, { limit = DEFAULT_AUCTION_COUNT, now = new Date() } = {}) {
  const languages = Object.keys(content || {});
  const needsAuctions = languages.some(l => hasAuctionPlaceholder(content[l]?.html));
  if (!needsAuctions) return { content, listings: [] };

  const listings = await pickFeaturedAuctions({ limit, now });
  if (listings.length === 0) {
    logger.warn('[newsletter] {{AUCTIONS}} used but no open auction qualifies — block rendered empty.');
  }

  const baseUrl = publicBaseUrl();
  const expanded = {};
  for (const l of languages) {
    const variant = content[l];
    expanded[l] = {
      ...variant,
      html: expandAuctionPlaceholders(variant?.html, l, listings, { baseUrl, now })
    };
  }
  return { content: expanded, listings };
}

module.exports = {
  NEWSLETTER_LANGUAGES,
  AUCTIONS_PLACEHOLDER,
  DEFAULT_AUCTION_COUNT,
  pickFeaturedAuctions,
  renderAuctionCard,
  renderAuctionsBlock,
  expandAuctionPlaceholders,
  expandCampaignContent,
  hasAuctionPlaceholder,
  localizedTitle,
  categoryLabel,
  formatPrice
};
