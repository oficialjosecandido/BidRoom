#!/usr/bin/env node
/**
 * Backfill -w480.webp / -w960.webp variants for existing listing images.
 *
 *   node src/scripts/backfill_image_variants.js --dry-run --limit 5
 *   node src/scripts/backfill_image_variants.js
 */

const path = require('path');
const https = require('https');
const http = require('http');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const connectDB = require('../config/database');
const Listing = require('../models/Listing');
const azureStorageService = require('../services/azureStorage.service');

function parseArgs(argv) {
  const out = { dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--limit') out.limit = Math.max(1, parseInt(argv[++i], 10) || 1);
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, { headers: { 'User-Agent': 'BidRoom-image-backfill/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadBuffer(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function variantExists(blobName) {
  const client = azureStorageService.containerClient.getBlockBlobClient(blobName);
  return client.exists();
}

async function ensureVariantsForUrl(imageUrl, { dryRun }) {
  const blobName = azureStorageService.blobNameFromUrl(imageUrl);
  if (!blobName) return { skipped: true, reason: 'bad-url' };

  // Skip non-raster / already-variant paths
  if (/-w(480|960)\.webp$/i.test(blobName)) {
    return { skipped: true, reason: 'already-variant' };
  }

  const missing = [];
  for (const name of azureStorageService.variantBlobNames(blobName)) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await variantExists(name);
    if (!exists) missing.push(name);
  }
  if (missing.length === 0) {
    return { skipped: true, reason: 'variants-exist' };
  }

  if (dryRun) {
    return { skipped: false, dryRun: true, wouldUpload: missing };
  }

  const buffer = await downloadBuffer(imageUrl);
  const uploaded = await azureStorageService.uploadImageVariants(buffer, blobName);
  return { skipped: false, uploaded: uploaded.map((u) => u.blobName) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!azureStorageService.containerClient) {
    console.error('AZURE_STORAGE_CONNECTION_STRING missing — aborting.');
    process.exit(1);
  }

  await connectDB();

  const cursor = Listing.find({ images: { $exists: true, $ne: [] } })
    .select('slug images')
    .lean()
    .cursor();

  let processed = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for await (const listing of cursor) {
    if (args.limit && processed >= args.limit) break;
    const urls = Array.isArray(listing.images) ? listing.images.filter(Boolean) : [];
    if (urls.length === 0) continue;

    processed += 1;
    console.log(`[${processed}] ${listing.slug || listing._id} · ${urls.length} image(s)`);

    for (const url of urls) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await ensureVariantsForUrl(url, { dryRun: args.dryRun });
        if (result.skipped) {
          skipped += 1;
          console.log(`  skip ${result.reason}: ${url.slice(0, 90)}`);
        } else if (result.dryRun) {
          created += 1;
          console.log(`  dry-run would upload: ${result.wouldUpload.join(', ')}`);
        } else {
          created += 1;
          console.log(`  ok: ${(result.uploaded || []).join(', ')}`);
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(80);
      } catch (err) {
        failed += 1;
        console.error(`  fail: ${err.message || err}`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(200);
      }
    }
  }

  console.log('\n—— Summary ——');
  console.log(`Listings touched: ${processed}`);
  console.log(`Images with new variants: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  if (args.dryRun) console.log('(dry-run — nothing written)');

  await require('mongoose').connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
