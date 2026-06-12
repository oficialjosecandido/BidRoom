const express  = require('express');
const https    = require('https');
const http     = require('http');
const Listing  = require('../models/Listing');
const { getBrandPNG } = require('../utils/ogImage');
const {
  pickShareLocale,
  getLocalizedListingText,
  buildOgTitle,
  buildOgDescription
} = require('../utils/shareMeta');

const router   = express.Router();
const FRONTEND = (process.env.FRONTEND_URL || 'https://www.bidroom.pt').replace(/\/$/, '');
// Served via SWA linked API: bidroom.pt/api/share/og-default.png
const DEFAULT_OG_IMAGE = `${FRONTEND}/api/share/og-default.png`;

/**
 * Check if an image URL responds 200. Many CDNs omit Content-Length on HEAD —
 * accept those; only reject clearly tiny responses (< 1 KB when length is known).
 */
function checkImage(imageUrl) {
  return new Promise((resolve) => {
    if (!imageUrl || !imageUrl.startsWith('http')) return resolve(null);

    const tryHead = (url, redirects = 0) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 2) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return tryHead(next, redirects + 1);
        }
        if (res.statusCode !== 200) return resolve(null);
        const len = parseInt(res.headers['content-length'] || '0', 10);
        if (len > 0 && len < 1000) return resolve(null);
        resolve(url);
      });
      req.on('error', () => resolve(imageUrl));
      req.on('timeout', () => { req.destroy(); resolve(imageUrl); });
      req.end();
    };

    tryHead(imageUrl);
  });
}

/** Detect social-media crawler user agents that need OG HTML. */
function isCrawler(ua = '') {
  return /facebookexternalhit|twitterbot|whatsapp|telegrambot|linkedinbot|slackbot|discordbot|pinterest|googlebot|bingbot|applebot|baiduspider|embedly|bufferbot|showyoubot|outbrain|W3C_Validator/i.test(ua);
}

/** Escape HTML special chars in attribute values. */
function esc(str = '') {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/"/g,  '&quot;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;');
}

/** GET /og-default.png — BidRoom branded PNG fallback for OG image */
router.get('/og-default.png', (_req, res) => {
  const png = getBrandPNG();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(png);
});

/**
 * GET /listing/:slug
 * Returns an OG-rich HTML page for social crawlers, with a JS redirect for browsers.
 * Mounted at /api/share (production share links) and /share (direct backend).
 */
router.get('/listing/:slug', async (req, res) => {
  try {
    const listing = await Listing.findOne({ slug: req.params.slug })
      .populate('seller', 'firstName lastName')
      .lean();

    const canonicalUrl = `${FRONTEND}/listing/${req.params.slug}`;
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
    const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    const sharePath = (req.originalUrl || req.url || '').split('?')[0];
    const shareUrl = host
      ? `${proto}://${host}${sharePath}`
      : `${FRONTEND}/api/share/listing/${req.params.slug}`;

    if (!listing) {
      return res.redirect(301, canonicalUrl);
    }

    const lang = pickShareLocale(req.headers['accept-language']);
    const { title, description } = getLocalizedListingText(listing, lang);

    const rawImage   = listing.images?.[0] || null;
    const validImage = rawImage ? await checkImage(rawImage) : null;
    const image      = validImage || DEFAULT_OG_IMAGE;

    const ogTitle       = esc(buildOgTitle(title));
    const ogDescription = esc(buildOgDescription(description, lang));
    const ogUrl         = esc(shareUrl);
    const ogImage       = esc(image);
    const ogCanonical   = esc(canonicalUrl);

    const ua = req.headers['user-agent'] || '';

    const redirectScript = isCrawler(ua) ? '' : `
    <script>window.location.replace(${JSON.stringify(canonicalUrl)});</script>
    <noscript><meta http-equiv="refresh" content="0;url=${ogCanonical}"></noscript>`;

    const html = `<!DOCTYPE html>
<html lang="${lang}" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="utf-8">
  <title>${ogTitle}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${ogDescription}">
  <meta name="robots" content="noindex, follow">

  <!-- Open Graph -->
  <meta property="og:type"        content="website">
  <meta property="og:site_name"   content="BidRoom">
  <meta property="og:locale"      content="${lang === 'pt' ? 'pt_PT' : 'en_US'}">
  <meta property="og:title"       content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:url"         content="${ogUrl}">
  <meta property="og:image"            content="${ogImage}">
  <meta property="og:image:secure_url" content="${ogImage}">
  <meta property="og:image:width"      content="1200">
  <meta property="og:image:height"     content="630">

  <!-- Twitter / X -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@bidroompt">
  <meta name="twitter:title"       content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image"       content="${ogImage}">

  <link rel="canonical" href="${ogCanonical}">
  ${redirectScript}
</head>
<body style="font-family:sans-serif;background:#0a0a0a;color:#f0ede8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center;padding:32px">
    <p style="color:#888;font-size:14px">A redirecionar para BidRoom…</p>
    <a href="${ogCanonical}" style="color:#c9a84c;font-size:13px">Clique aqui se não for redireccionado</a>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120');
    res.send(html);
  } catch (err) {
    console.error('[share] Error:', err.message);
    res.redirect(302, `${FRONTEND}/listing/${req.params.slug}`);
  }
});

module.exports = router;
