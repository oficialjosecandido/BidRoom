#!/usr/bin/env node
/**
 * Re-classify Vinted listings by title + translate titles to PT/EN/ES/FR.
 *
 *   node src/scripts/vinted_retitle_recategorize.js --dry-run --limit 3
 *   node src/scripts/vinted_retitle_recategorize.js
 */

const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const connectDB = require('../config/database');
const Listing = require('../models/Listing');

function parseArgs(argv) {
  const out = { dryRun: false, limit: null, needsTranslation: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--needs-translation') out.needsTranslation = true;
    else if (argv[i] === '--limit') out.limit = Math.max(1, parseInt(argv[++i], 10) || 1);
  }
  return out;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function classifyFromTitle(title) {
  const t = norm(title);

  const isClothing = /\b(jupe|skirt|gonna|robe|dress|veste|jacket|giacca|blazer|tailleur|blouse|camicia|pull|cardigan|gilet|sweat|t-?shirt|imper|culotte|maillot|ceinture|belt|cap|casquette|scarpe|sandal|shoe|abito|completo|denim|chemise|saia|casaco)\b/.test(t);
  const isBag = /\b(bag|sac\b|bolsa|bolso|borsa|cabas|hobo|tote|pochette|wallet|portefeuille|penztarca|schoudertas|cassandre|loulou|muse two|bandouliere|handbag|shoulder|cabas)\b/.test(t);
  const isWatch = /\b(montre|watch|reloj|orologio|uhr|cadran)\b/.test(t);
  const isJewelry = /\b(earring|orecchin|boucle|brooch|spilla|bracelet|bracelete|pulseira|necklace|collier|collana|colar|clip-on|pendentif|pendant|bijou)\b/.test(t);
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

function detectLang(title) {
  const t = norm(title);
  if (/\b(jupe|robe|veste|sac|parfum|lunettes|taille|noir|bleu|vintage authentique|eau de)\b/.test(t)) return 'fr';
  if (/\b(borsa|gonna|giacca|occhiali|orecchini|abito|completo|pelle|seta|anni)\b/.test(t)) return 'it';
  if (/\b(bolso|bolsa|pintalabios|reloj|negro|con)\b/.test(t) && /\b(ysl|saint)\b/.test(t)) {
    if (/\b(bolso|pintalabios)\b/.test(t)) return 'es';
  }
  if (/\b(bolsa|relógio|máscara|pestanas)\b/.test(t)) return 'pt';
  if (/\b(schoudertas|zwarte|goed|maat)\b/.test(t)) return 'nl';
  if (/\b(pénztárca|színben|dobozzal|bőr)\b/.test(t)) return 'hu';
  if (/\b(the|with|for|women|vintage|black|white)\b/.test(t)) return 'en';
  return 'en';
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 BidRoom/1.0' } }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 120)}`));
            return;
          }
          resolve(data);
        });
      })
      .on('error', reject);
  });
}

async function googleTranslate(text, source, target, retries = 3) {
  const q = encodeURIComponent(text.slice(0, 450));
  const sl = source === 'auto' ? 'auto' : source;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${target}&dt=t&q=${q}`;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const raw = await httpGet(url);
      const data = JSON.parse(raw);
      const out = Array.isArray(data?.[0])
        ? data[0].map((part) => part?.[0] || '').join('')
        : '';
      if (!out) throw new Error('empty translation');
      return out;
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  return text;
}

function clampTitle(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function titlesNeedTranslation(L) {
  const a = clampTitle(L.titlePt || L.title);
  const b = clampTitle(L.titleEn || L.title);
  const c = clampTitle(L.titleEs || L.title);
  const d = clampTitle(L.titleFr || L.title);
  return a === b && b === c && c === d;
}

async function translateTitles(sourceTitle) {
  const src = clampTitle(sourceTitle);
  const sourceLang = detectLang(src);
  let rateLimited = false;

  let en = src;
  if (sourceLang !== 'en') {
    try {
      en = clampTitle(await googleTranslate(src, sourceLang, 'en')) || src;
    } catch (e) {
      rateLimited = true;
      en = src;
    }
    await sleep(250);
  }

  async function to(lang) {
    if (lang === 'en') return en;
    try {
      const out = clampTitle(await googleTranslate(en, 'en', lang)) || en;
      await sleep(250);
      return out;
    } catch (e) {
      rateLimited = true;
      await sleep(800);
      return en;
    }
  }

  const titlePt = await to('pt');
  const titleEs = await to('es');
  const titleFr = await to('fr');
  return {
    title: titlePt,
    titlePt,
    titleEn: en,
    titleEs,
    titleFr,
    rateLimited
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await connectDB();

  let listings = await Listing.find({
    $or: [
      { 'attributes.vintedItemId': { $exists: true, $ne: null } },
      { specifications: { $elemMatch: { key: 'vintedItemId' } } }
    ]
  })
    .select('title titlePt titleEn titleEs titleFr category subCategory slug attributes')
    .lean();

  if (args.needsTranslation) {
    listings = listings.filter(titlesNeedTranslation);
  }
  if (args.limit) listings = listings.slice(0, args.limit);
  console.log(`Found ${listings.length} Vinted listings · dryRun=${args.dryRun} · needsTranslation=${args.needsTranslation}`);

  const catCount = {};
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < listings.length; i += 1) {
    const L = listings[i];
    const label = `[${i + 1}/${listings.length}]`;
    try {
      // When all langs are still identical, title is still the original source
      const sourceTitle = L.title || L.titleEn;
      const { category, subCategory } = classifyFromTitle(sourceTitle);
      catCount[`${category}/${subCategory}`] = (catCount[`${category}/${subCategory}`] || 0) + 1;
      const titles = await translateTitles(sourceTitle);

      console.log(`${label} ${L.slug}`);
      console.log(`  src: ${sourceTitle}`);
      console.log(`  pt:  ${titles.titlePt}`);
      console.log(`  en:  ${titles.titleEn}`);
      console.log(`  es:  ${titles.titleEs}`);
      console.log(`  fr:  ${titles.titleFr}`);
      console.log(`  cat: ${category} / ${subCategory}${titles.rateLimited ? '  (rate-limited)' : ''}`);

      if (titles.rateLimited) {
        skipped += 1;
        failed += 1;
        await sleep(3000);
        continue;
      }

      if (!args.dryRun) {
        await Listing.updateOne(
          { _id: L._id },
          {
            $set: {
              title: titles.titlePt,
              titlePt: titles.titlePt,
              titleEn: titles.titleEn,
              titleEs: titles.titleEs,
              titleFr: titles.titleFr,
              category,
              subCategory,
              'attributes.vintedTitlesTranslated': true
            }
          }
        );
      }
      updated += 1;
      await sleep(500);
    } catch (err) {
      failed += 1;
      console.error(`❌ ${label} ${L.slug}: ${err.message || err}`);
      await sleep(1500);
    }
  }

  console.log('\n—— Category tally ——');
  Object.entries(catCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${v}  ${k}`));
  console.log('\n—— Summary ——');
  console.log(`Updated: ${updated}`);
  console.log(`Failed/skipped:  ${failed}`);
  if (args.dryRun) console.log('(dry-run — nothing written)');

  await require('mongoose').connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
