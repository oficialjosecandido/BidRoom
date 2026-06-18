const express  = require('express');
const https    = require('https');
const http     = require('http');
const Listing  = require('../models/Listing');
const { getBrandPNG } = require('../utils/ogImage');
const {
  pickShareLocale,
  getLocalizedListingText,
  buildOgTitle,
  buildOgDescription,
} = require('../utils/shareMeta');

const router   = express.Router();
const FRONTEND = (process.env.FRONTEND_URL_PROD || process.env.FRONTEND_URL || 'https://www.bidroom.pt').replace(/\/$/, '');
const DEFAULT_OG_IMAGE = `${FRONTEND}/api/share/og-default.png`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true for URLs hosted on our own Azure Blob Storage.
 * We trust these directly — no need to probe with a HEAD request.
 */
function isTrustedImageUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  try {
    const { hostname } = new URL(url);
    return hostname.endsWith('.blob.core.windows.net');
  } catch {
    return false;
  }
}

/**
 * Probes an *external* image URL with a HEAD request.
 * Returns the URL if reachable, null otherwise.
 * Only used for non-Azure images (rare).
 */
function checkImage(imageUrl) {
  return new Promise((resolve) => {
    if (!imageUrl || !imageUrl.startsWith('http')) return resolve(null);

    const tryHead = (url, redirects = 0) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method: 'HEAD', timeout: 3000 }, (res) => {
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
      req.on('error',   () => resolve(imageUrl)); // best-effort on error
      req.on('timeout', () => { req.destroy(); resolve(imageUrl); });
      req.end();
    };

    tryHead(imageUrl);
  });
}

/**
 * Infer the MIME type from the image URL extension.
 * Returns null when the type cannot be determined.
 */
function imageType(url = '') {
  const clean = url.split('?')[0].toLowerCase();
  if (/\.(jpe?g)$/.test(clean)) return 'image/jpeg';
  if (/\.png$/.test(clean))     return 'image/png';
  if (/\.gif$/.test(clean))     return 'image/gif';
  if (/\.webp$/.test(clean))    return 'image/webp';
  return null;
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

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /og-default.png — BidRoom branded PNG fallback (1200×630) */
router.get('/og-default.png', (_req, res) => {
  res.setHeader('Content-Type',  'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(getBrandPNG());
});

/**
 * GET /listing/:slug
 *
 * For social crawlers — returns OG-rich HTML (no JS redirect).
 * For browsers       — instant JS redirect to the canonical listing URL.
 *
 * Mounted at /api/share (Azure SWA linked backend) and /share (local / direct).
 */
router.get('/listing/:slug', async (req, res) => {
  try {
    const listing = await Listing.findOne({ slug: req.params.slug })
      .populate('seller', 'firstName lastName')
      .lean();

    const canonicalUrl = `${FRONTEND}/listing/${req.params.slug}`;

    const proto     = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
    const host      = (req.get('x-forwarded-host')  || req.get('host') || '').split(',')[0].trim();
    const sharePath = (req.originalUrl || req.url || '').split('?')[0];
    const shareUrl  = host
      ? `${proto}://${host}${sharePath}`
      : `${FRONTEND}/api/share/listing/${req.params.slug}`;

    if (!listing) {
      return res.redirect(301, canonicalUrl);
    }

    const lang  = pickShareLocale(req.headers['accept-language']);
    const { title, description } = getLocalizedListingText(listing, lang);

    // ── Resolve the OG image ─────────────────────────────────────────────────
    const rawImage = listing.images?.[0] || null;
    let resolvedImage = DEFAULT_OG_IMAGE;

    if (rawImage) {
      if (isTrustedImageUrl(rawImage)) {
        // Azure Blob Storage — trust directly, no network probe needed
        resolvedImage = rawImage;
      } else {
        // External URL — probe (rare case)
        const probed = await checkImage(rawImage);
        resolvedImage = probed || DEFAULT_OG_IMAGE;
      }
    }

    const isDefaultImage = resolvedImage === DEFAULT_OG_IMAGE;
    const detectedType   = isDefaultImage ? 'image/png' : imageType(resolvedImage);

    // ── Build escaped OG values ──────────────────────────────────────────────
    const ogTitle       = esc(buildOgTitle(title));
    const ogDescription = esc(buildOgDescription(description));
    const ogUrl         = esc(canonicalUrl);
    const ogImage       = esc(resolvedImage);
    const ogCanonical   = esc(canonicalUrl);
    const ogImageAlt    = esc(title || 'BidRoom listing');

    // ── Optional dimension tags (only for our known-size default image) ──────
    const dimensionTags = isDefaultImage
      ? `\n  <meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">`
      : '';

    const typeTags = detectedType
      ? `\n  <meta property="og:image:type" content="${esc(detectedType)}">`
      : '';

    // Browsers get a JS redirect; crawlers receive the full OG page.
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
  <meta property="og:type"             content="website">
  <meta property="og:site_name"        content="BidRoom">
  <meta property="og:locale"           content="${lang === 'pt' ? 'pt_PT' : 'en_US'}">
  <meta property="og:title"            content="${ogTitle}">
  <meta property="og:description"      content="${ogDescription}">
  <meta property="og:url"              content="${ogUrl}">
  <meta property="og:image"            content="${ogImage}">
  <meta property="og:image:secure_url" content="${ogImage}">
  <meta property="og:image:alt"        content="${ogImageAlt}">${dimensionTags}${typeTags}

  <!-- Twitter / X -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@bidroompt">
  <meta name="twitter:title"       content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image"       content="${ogImage}">
  <meta name="twitter:image:alt"   content="${ogImageAlt}">

  <link rel="canonical" href="${ogCanonical}">${redirectScript}
</head>
<body style="font-family:sans-serif;background:#0a0a0a;color:#f0ede8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center;padding:32px">
    <p style="color:#888;font-size:14px">A redirecionar para BidRoom…</p>
    <a href="${ogCanonical}" style="color:#c9a84c;font-size:13px">Clique aqui se não for redireccionado</a>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type',  'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120');
    res.send(html);

  } catch (err) {
    console.error('[share] Error:', err.message);
    res.redirect(302, `${FRONTEND}/listing/${req.params.slug}`);
  }
});

module.exports = router;
