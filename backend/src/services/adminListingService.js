const Listing = require('../models/Listing');
const Customer = require('../models/Customer');

const ALLOWED_CATEGORIES = [
  'electronics',
  'home-garden',
  'art',
  'collectibles',
  'jewelry',
  'real-estate',
  'vehicles'
];

const ALLOWED_CONDITIONS = [
  'New',
  'Used - Excellent',
  'Used - Very Good',
  'Used - Good',
  'Used - Fair',
  'For Parts or Not Working'
];

const ALLOWED_DURATIONS = {
  '5 minutes': 5 * 60 * 1000,
  '1 hour': 1 * 60 * 60 * 1000,
  '2 hours': 2 * 60 * 60 * 1000,
  '7 hours': 7 * 60 * 60 * 1000,
  '24 hours': 24 * 60 * 60 * 1000,
  '3 days': 3 * 24 * 60 * 60 * 1000,
  '7 days': 7 * 24 * 60 * 60 * 1000,
  '10 days': 10 * 24 * 60 * 60 * 1000,
  '15 days': 15 * 24 * 60 * 60 * 1000,
  '30 days': 30 * 24 * 60 * 60 * 1000
};

const ALLOWED_SHIPPING = ['flat-rate', 'calculated', 'local-pickup', 'free'];
const ALLOWED_RETURNS = ['30-days', '14-days', 'no-returns', 'custom'];
const ALLOWED_FORMATS = ['highest-bid', 'best-offer'];

function generateSlug(title) {
  const base = String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `listing-${Date.now()}`;
}

async function uniqueSlug(title) {
  let baseSlug = generateSlug(title);
  let slug = baseSlug;
  let counter = 1;
  while (await Listing.findOne({ slug }).select('_id').lean()) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }
  return slug;
}

function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/**
 * Create a listing on behalf of a seller (Nexus admin).
 * Skips seller DSA/KYC gates; still validates required fields.
 */
async function createListingAsAdmin(input = {}) {
  const sellerId = input.sellerId ? String(input.sellerId).trim() : '';
  const sellerEmail = input.sellerEmail ? String(input.sellerEmail).trim().toLowerCase() : '';

  let seller = null;
  if (sellerId) {
    seller = await Customer.findById(sellerId).select('_id email firstName lastName').lean();
  } else if (sellerEmail) {
    seller = await Customer.findOne({ email: sellerEmail }).select('_id email firstName lastName').lean();
  }
  if (!seller) {
    const err = new Error('Seller not found. Provide a valid sellerId or sellerEmail.');
    err.status = 404;
    throw err;
  }

  const title = String(input.title || '').trim().slice(0, 80);
  const description = String(input.description || '').trim().slice(0, 5000);
  if (!title) {
    const err = new Error('Title is required.');
    err.status = 400;
    throw err;
  }
  if (description.length < 50) {
    const err = new Error('Description must be at least 50 characters.');
    err.status = 400;
    throw err;
  }

  const category = normalizeCategory(input.category) || 'jewelry';
  if (!ALLOWED_CATEGORIES.includes(category)) {
    const err = new Error(`Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const subCategory = String(input.subCategory || 'Luxury Watches').trim() || 'Luxury Watches';
  const condition = String(input.condition || 'Used - Excellent').trim();
  if (!ALLOWED_CONDITIONS.includes(condition)) {
    const err = new Error(`Invalid condition. Allowed: ${ALLOWED_CONDITIONS.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const auctionFormat = ALLOWED_FORMATS.includes(input.auctionFormat || input.listingFormat)
    ? (input.auctionFormat || input.listingFormat)
    : 'highest-bid';

  const durationSlot = ALLOWED_DURATIONS[input.duration || input.durationSlot]
    ? (input.duration || input.durationSlot)
    : '7 days';

  const startingPrice = Math.max(0, Number(input.startingPrice ?? 0));
  if (Number.isNaN(startingPrice)) {
    const err = new Error('startingPrice must be a number.');
    err.status = 400;
    throw err;
  }

  const shippingOption = ALLOWED_SHIPPING.includes(input.shippingOption)
    ? input.shippingOption
    : 'flat-rate';
  const returnPolicy = ALLOWED_RETURNS.includes(input.returnPolicy)
    ? input.returnPolicy
    : 'no-returns';

  const shippingCost = shippingOption === 'flat-rate'
    ? Math.max(0, Number(input.shippingCost ?? 0) || 0)
    : 0;

  const locationCity = String(input.locationCity || 'Lisboa').trim() || 'Lisboa';
  const locationCountry = String(input.locationCountry || 'PT').trim().toUpperCase().slice(0, 2) || 'PT';
  const location = String(input.location || `${locationCity}, ${locationCountry}`).trim();

  let images = [];
  if (Array.isArray(input.images)) {
    images = input.images.map((u) => String(u).trim()).filter(Boolean).slice(0, 20);
  } else if (typeof input.images === 'string' && input.images.trim()) {
    images = input.images.split(/[|,]/).map((u) => u.trim()).filter(Boolean).slice(0, 20);
  }

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + ALLOWED_DURATIONS[durationSlot]);
  const slug = await uniqueSlug(title);

  const listing = new Listing({
    title,
    titlePt: title,
    description,
    descriptionPt: description,
    slug,
    category,
    subCategory,
    condition,
    auctionFormat,
    durationSlot,
    startingPrice,
    currentPrice: startingPrice,
    bidIncrement: Math.max(0.01, Number(input.bidIncrement ?? 1) || 1),
    startDate,
    endDate,
    seller: seller._id,
    status: 'active',
    shippingOption,
    shippingCost,
    returnPolicy,
    handlingTime: Math.max(1, Math.min(30, parseInt(input.handlingTime, 10) || 5)),
    location,
    locationCity,
    locationCountry,
    allowPrivateRoom: auctionFormat === 'highest-bid' ? !!input.allowPrivateRoom : false,
    images,
    specifications: Array.isArray(input.specifications) ? input.specifications : []
  });

  await listing.save();

  return {
    listing,
    seller
  };
}

/**
 * Minimal CSV parser supporting quoted fields and commas inside quotes.
 * First row = headers. Returns array of objects keyed by header.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(field);
      field = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      if (ch === '\r') i += 1;
      continue;
    }
    if (ch === '\r') {
      row.push(field);
      field = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => String(c).trim() !== '')) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] != null ? String(cols[idx]).trim() : '';
    });
    return obj;
  });
}

function mapCsvRowToCreateInput(row) {
  return {
    sellerEmail: row.sellerEmail || row.seller_email || row.email || '',
    sellerId: row.sellerId || row.seller_id || '',
    title: row.title || '',
    description: row.description || '',
    category: row.category || 'jewelry',
    subCategory: row.subCategory || row.sub_category || 'Luxury Watches',
    condition: row.condition || 'Used - Excellent',
    listingFormat: row.auctionFormat || row.listingFormat || row.format || 'highest-bid',
    startingPrice: row.startingPrice || row.price || 0,
    duration: row.duration || row.durationSlot || '7 days',
    shippingOption: row.shippingOption || row.shipping || 'flat-rate',
    shippingCost: row.shippingCost || 0,
    returnPolicy: row.returnPolicy || 'no-returns',
    locationCity: row.locationCity || row.city || 'Lisboa',
    locationCountry: row.locationCountry || row.country || 'PT',
    images: row.images || row.imageUrls || '',
    allowPrivateRoom: /^(1|true|yes)$/i.test(String(row.allowPrivateRoom || ''))
  };
}

module.exports = {
  ALLOWED_CATEGORIES,
  ALLOWED_CONDITIONS,
  ALLOWED_DURATIONS,
  ALLOWED_SHIPPING,
  ALLOWED_RETURNS,
  ALLOWED_FORMATS,
  createListingAsAdmin,
  parseCsv,
  mapCsvRowToCreateInput
};
