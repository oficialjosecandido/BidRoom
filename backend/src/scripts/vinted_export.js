#!/usr/bin/env node
/**
 * Import Vinted export CSV + images into BidRoom (Mongo + Azure Blob).
 *
 * From backend/:
 *   node src/scripts/vinted_export.js
 *   node src/scripts/vinted_export.js --dry-run
 *   node src/scripts/vinted_export.js --limit 5
 *   node src/scripts/vinted_export.js --csv ../vinted_descricoes_pt_en_es_fr_marketplace.csv --zip ../vinted_export.zip
 *
 * From repo root:
 *   ./scripts/vinted_export.sh
 *   npm run vinted:export --prefix backend
 *
 * Requires backend/.env with MONGO_URI (or MONGODB_URI) and AZURE_STORAGE_CONNECTION_STRING.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

// Prefer backend/.env regardless of cwd
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const connectDB = require('../config/database');
const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const azureStorageService = require('../services/azureStorage.service');
const { createListingAsAdmin, parseCsv } = require('../services/adminListingService');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_CSV = path.join(REPO_ROOT, 'vinted_descricoes_pt_en_es_fr_marketplace.csv');
const DEFAULT_ZIP = path.join(REPO_ROOT, 'vinted_export.zip');
const ZIP_CSV_FALLBACK = path.join(REPO_ROOT, 'vinted_export', 'vinted.csv');

function parseArgs(argv) {
  const out = {
    csv: null,
    zip: DEFAULT_ZIP,
    dryRun: false,
    limit: null,
    skipExisting: true,
    sellerEmail: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-skip-existing') out.skipExisting = false;
    else if (a === '--csv') out.csv = path.resolve(argv[++i]);
    else if (a === '--zip') out.zip = path.resolve(argv[++i]);
    else if (a === '--limit') out.limit = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--seller-email') out.sellerEmail = String(argv[++i] || '').trim().toLowerCase();
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function resolveCsvPath(args, extractRoot) {
  if (args.csv && fs.existsSync(args.csv)) return args.csv;
  if (fs.existsSync(DEFAULT_CSV)) return DEFAULT_CSV;
  if (fs.existsSync(ZIP_CSV_FALLBACK)) return ZIP_CSV_FALLBACK;
  const fromExtract = extractRoot
    ? [
        path.join(extractRoot, 'vinted_export', 'vinted.csv'),
        path.join(extractRoot, 'vinted.csv')
      ].find((p) => fs.existsSync(p))
    : null;
  if (fromExtract) return fromExtract;
  return null;
}

function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

function normalizeSellerEmail(email) {
  let e = String(email || '').trim().toLowerCase();
  if (e.endsWith('@gmail.co')) e = `${e}m`;
  if (e === 'pt.bidnow@gmail.co') e = 'pt.bidnow@gmail.com';
  return e || 'pt.bidnow@gmail.com';
}

function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Classify BidRoom category/subCategory from listing title (CSV Vinted cats are unreliable). */
function classifyFromTitle(title) {
  const t = normTitle(title);

  const isClothing = /\b(jupe|skirt|gonna|robe|dress|veste|jacket|giacca|blazer|tailleur|blouse|camicia|pull|cardigan|gilet|sweat|t-?shirt|imper|culotte|maillot|ceinture|belt|cap|casquette|scarpe|sandal|shoe|abito|completo|denim|chemise|saia|casaco|fergani|mariee|coat|manteau)\b/.test(t);
  const isBag = /\b(bag|sac\b|bolsa|bolso|borsa|cabas|hobo|tote|pochette|wallet|portefeuille|penztarca|schoudertas|cassandre|loulou|muse two|bandouliere|handbag|shoulder|kelly|birkin|delvaux|pin osier|brillant)\b/.test(t);
  const isWatch = /\b(montre|watch|reloj|orologio|uhr|cadran|tank must|chronograph|chronographe|quartz|horlogerie|hydroconquest|datejust|submariner|seamaster|daytona|nautilus|royal oak)\b/.test(t)
    || (/\b(cartier|rolex|omega|patek|longines|tudor|breitling|hublot|iwc|seiko|tissot|hamilton|tag heuer|audemars|vacheron|jaeger)\b/.test(t)
      && !/\b(bag|sac|bolsa|parfum|bracelet|collier|necklace|ring|bague)\b/.test(t));
  const isJewelry = /\b(earring|orecchin|boucle|brooch|spilla|bracelet|bracelete|pulseira|necklace|collier|collana|colar|clip-on|pendentif|pendant|bijou|parure|armband|ring\b|anel|bague|karaat|carat|18k|jonc|goud|gold set|sieraden)\b/.test(t)
    || (/\bor\b/.test(t) && /\b(parure|bracelet|collier|jonc|massif|carat|karaat)\b/.test(t));
  const isEyewear = /\b(lunette|occhiali|sunglasses|soleil|oculos)\b/.test(t);
  const isBeauty = (
    /\b(parfum|perfume|eau de toilette|eau de parfum|mascara|blush|lipstick|foundation|primer|palette|make.?up|pintalabios|hydra|opium|libre berry|toilette|crayon a levre|rouge a levre|rouge pour|fard|cushion|miniatura|miroir|mirror|espejo)\b/.test(t)
    || (/\brouge\b/.test(t) && /\b(levre|labios|lipstick|couture n)\b/.test(t))
  ) && !isClothing;

  if (isWatch) return { category: 'jewelry', subCategory: 'Luxury Watches' };
  if (isJewelry) return { category: 'jewelry', subCategory: 'Fine Jewelry' };
  if (isBeauty) return { category: 'collectibles', subCategory: 'Beauty' };
  if (isBag || isEyewear || isClothing) return { category: 'collectibles', subCategory: 'Fashion' };
  return { category: 'collectibles', subCategory: 'Fashion' };
}

function normalizeCategory(row, title) {
  // Prefer title heuristics — Vinted CSV often has Women/Other
  const fromTitle = classifyFromTitle(title || row.titulo || row.title);
  const rawCat = String(row.category || '').trim().toLowerCase();
  if (/jewelry|watch/.test(rawCat) && fromTitle.category === 'collectibles') {
    // CSV says jewelry but title didn't match — keep title Fashion unless watch/jewelry keywords weak
    if (/watch/.test(rawCat)) return { category: 'jewelry', subCategory: 'Luxury Watches' };
    if (/jewelry/.test(rawCat)) return { category: 'jewelry', subCategory: 'Fine Jewelry' };
  }
  return fromTitle;
}

function normalizeCountry(value) {
  const v = String(value || '').trim();
  if (!v || /^portugal$/i.test(v) || /^pt-pt$/i.test(v)) return 'PT';
  return v.slice(0, 2).toUpperCase();
}

function ensureMinDescription(text, fallbackTitle) {
  let d = String(text || '').trim();
  if (d.length >= 50) return d.slice(0, 5000);
  const pad = ` — ${fallbackTitle || 'Item'} — importado para BidRoom.`;
  while (d.length < 50) d += pad;
  return d.slice(0, 5000);
}

function readCsvRows(csvPath) {
  const raw = fs.readFileSync(csvPath);
  const text = raw.toString('utf8').replace(/^\uFEFF/, '');
  return parseCsv(text);
}

function unzipToTemp(zipPath) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bidroom-vinted-'));
  console.log(`📦 Extracting zip → ${dest}`);
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', dest], { stdio: 'inherit' });
  return dest;
}

function resolveImageAbsolute(extractRoot, relativePath) {
  const rel = String(relativePath || '').trim().replace(/\\/g, '/');
  if (!rel) return null;
  const candidates = [
    path.join(extractRoot, rel),
    path.join(extractRoot, rel.replace(/^vinted_export\//, '')),
    path.join(REPO_ROOT, rel),
    path.join(REPO_ROOT, 'vinted_export', rel.replace(/^vinted_export\//, ''))
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

async function uploadLocalImages(absPaths) {
  const urls = [];
  for (const abs of absPaths) {
    const buffer = fs.readFileSync(abs);
    const mimetype = mimeFromExt(abs);
    const originalFilename = path.basename(abs);
    const { url } = await azureStorageService.uploadImage(buffer, originalFilename, mimetype);
    urls.push(url);
  }
  return urls;
}

async function alreadyImported(vintedItemId) {
  if (!vintedItemId) return null;
  // attributes Map query
  const existing = await Listing.findOne({
    $or: [
      { [`attributes.vintedItemId`]: String(vintedItemId) },
      { 'specifications.key': 'vintedItemId', 'specifications.value': String(vintedItemId) }
    ]
  }).select('_id title slug').lean();
  return existing;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node src/scripts/vinted_export.js [options]

Options:
  --csv <path>           Marketplace CSV (default: repo root marketplace csv)
  --zip <path>           Images zip (default: repo root vinted_export.zip)
  --seller-email <email> Override seller email for all rows
  --limit <n>            Import only first N rows
  --dry-run              Parse + validate, do not upload/create
  --no-skip-existing     Recreate even if vintedItemId already exists
  -h, --help             Show help
`);
    process.exit(0);
  }

  if (!fs.existsSync(args.zip)) {
    console.error(`❌ ZIP not found: ${args.zip}`);
    process.exit(1);
  }

  console.log('ZIP:', args.zip);
  console.log('Mode:', args.dryRun ? 'DRY RUN' : 'LIVE IMPORT');

  let extractRoot = null;
  try {
    extractRoot = unzipToTemp(args.zip);
    const csvPath = resolveCsvPath(args, extractRoot);
    if (!csvPath) {
      console.error('❌ CSV not found (pass --csv or include vinted_export/vinted.csv in the zip)');
      process.exit(1);
    }
    console.log('CSV:', csvPath);

    const rows = readCsvRows(csvPath);
    console.log(`📄 Rows in CSV: ${rows.length}`);
    const selected = args.limit ? rows.slice(0, args.limit) : rows;

    if (!args.dryRun) {
      await connectDB();
      if (!azureStorageService.blobServiceClient) {
        console.error('❌ AZURE_STORAGE_CONNECTION_STRING missing — cannot upload images.');
        process.exit(1);
      }
      await azureStorageService.ensureContainerExists();
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const catCount = {};

    for (let i = 0; i < selected.length; i += 1) {
      const row = selected[i];
      const itemId = String(row.item_id || row['\ufeffitem_id'] || '').trim();
      const title = String(row.titulo || row.title || '').trim().slice(0, 80);
      const label = `[${i + 1}/${selected.length}] ${itemId || '?'} ${title || '(no title)'}`;

      try {
        if (!title) throw new Error('Missing title');

        if (args.skipExisting && itemId && !args.dryRun) {
          const existing = await alreadyImported(itemId);
          if (existing) {
            console.log(`⏭️  ${label} — already imported (${existing.slug})`);
            skipped += 1;
            continue;
          }
        }

        const sellerEmail = normalizeSellerEmail(args.sellerEmail || row.sellerEmail || row.seller);
        const { category, subCategory } = normalizeCategory(row, title);
        catCount[`${category}/${subCategory}`] = (catCount[`${category}/${subCategory}`] || 0) + 1;
        const descriptionPt = ensureMinDescription(row.descricao_pt || row.description || row.descricao_original || row.descricao, title);
        const descriptionEn = row.descricao_en ? String(row.descricao_en).trim() : null;
        const descriptionEs = row.descricao_es ? String(row.descricao_es).trim() : null;
        const descriptionFr = row.descricao_fr ? String(row.descricao_fr).trim() : null;

        const imageRefs = String(row.ficheiros_imagens || '')
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);

        const absImages = [];
        for (const ref of imageRefs) {
          const abs = resolveImageAbsolute(extractRoot, ref);
          if (!abs) throw new Error(`Image not found in zip/extract: ${ref}`);
          absImages.push(abs);
        }
        if (absImages.length === 0) {
          console.warn(`⚠️  ${label} — no images; will create without photos`);
        }

        if (args.dryRun) {
          console.log(`✅ ${label} — dry-run OK (${absImages.length} images, seller ${sellerEmail}, ${category}/${subCategory})`);
          created += 1;
          continue;
        }

        const seller = await Customer.findOne({ email: sellerEmail }).select('_id email').lean();
        if (!seller) {
          throw new Error(`Seller not found for email ${sellerEmail}. Create this account first.`);
        }

        console.log(`⬆️  ${label} — uploading ${absImages.length} image(s)…`);
        const imageUrls = absImages.length ? await uploadLocalImages(absImages) : [];

        const { listing } = await createListingAsAdmin({
          sellerId: seller._id.toString(),
          title,
          titleEn: row.titulo_en || null,
          description: descriptionPt,
          descriptionEn,
          descriptionEs,
          descriptionFr,
          category,
          subCategory,
          condition: row.condition || 'Used - Excellent',
          listingFormat: row.auctionFormat || row.listingFormat || 'best-offer',
          startingPrice: Number(row.preco || row.startingPrice || 0) || 0,
          duration: row.duration || '30 days',
          shippingOption: row.shippingOption || 'flat-rate',
          shippingCost: Number(row.shippingCost || 15) || 15,
          returnPolicy: row.returnPolicy || 'no-returns',
          locationCity: row.locationCity || 'Lisboa',
          locationCountry: normalizeCountry(row.locationCountry),
          images: imageUrls,
          allowPrivateRoom: false,
          attributes: {
            vintedItemId: itemId || undefined,
            vintedUrl: row.url || undefined,
            importSource: 'vinted_export'
          },
          specifications: itemId
            ? [{ key: 'vintedItemId', value: String(itemId) }]
            : []
        });

        console.log(`✅ ${label} → /listing/${listing.slug}`);
        created += 1;
      } catch (err) {
        failed += 1;
        console.error(`❌ ${label} — ${err.message || err}`);
      }
    }

    console.log('\n—— Category tally ——');
    Object.entries(catCount)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`  ${v}  ${k}`));
    console.log('\n—— Summary ——');
    console.log(`Created/validated: ${created}`);
    console.log(`Skipped existing:  ${skipped}`);
    console.log(`Failed:            ${failed}`);
    if (args.dryRun) console.log('(dry-run — nothing written)');
  } finally {
    if (extractRoot && fs.existsSync(extractRoot)) {
      try {
        fs.rmSync(extractRoot, { recursive: true, force: true });
      } catch (_) {
        /* ignore */
      }
    }
    // Allow mongoose to close cleanly
    try {
      const mongoose = require('mongoose');
      await mongoose.connection.close();
    } catch (_) {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
