const express  = require('express');
const Listing  = require('../models/Listing');

const router   = express.Router();

const FRONTEND = process.env.FRONTEND_URL || 'https://www.bidroom.pt';
const SITE_NAME = 'BidRoom';
const DEFAULT_OG_IMAGE = `${FRONTEND}/og-image.svg`;

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

/** Format price as €X,XXX */
function fmtPrice(n) {
  if (!n || n === 0) return '';
  return '€' + Number(n).toLocaleString('pt-PT', { minimumFractionDigits: 0 });
}

/** Format time remaining. */
function fmtTime(endDate) {
  if (!endDate) return '';
  const ms = new Date(endDate).getTime() - Date.now();
  if (ms <= 0) return 'Encerrado';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.floor(ms / 60_000)} min restantes`;
  if (h < 24) return `${h}h restantes`;
  return `${Math.floor(h / 24)} dias restantes`;
}

/**
 * GET /share/listing/:slug
 * Returns an OG-rich HTML page for social crawlers, with a JS redirect for browsers.
 * This page is meant to be the "shareable URL" for listing pages.
 */
router.get('/listing/:slug', async (req, res) => {
  try {
    const listing = await Listing.findOne({ slug: req.params.slug })
      .populate('seller', 'firstName lastName')
      .lean();

    // Unknown listing — redirect to frontend
    if (!listing) {
      return res.redirect(301, `${FRONTEND}/listing/${req.params.slug}`);
    }

    const canonicalUrl = `${FRONTEND}/listing/${listing.slug}`;
    const image        = (listing.images?.[0]) || DEFAULT_OG_IMAGE;
    const price        = fmtPrice(listing.currentPrice || listing.startingPrice);
    const timeLeft     = fmtTime(listing.endDate);
    const format       = listing.auctionFormat === 'best-offer' ? 'Melhor Proposta' : 'Leilão';
    const condition    = listing.condition ? ` · ${listing.condition}` : '';

    const ogTitle       = esc(`${listing.title} — ${SITE_NAME}`);
    const ogDescription = esc(
      [price, format, timeLeft, condition.trim()].filter(Boolean).join(' · ') +
      '. Compra segura com escrow BidRoom.'
    );
    const ogUrl   = esc(canonicalUrl);
    const ogImage = esc(image);

    const ua = req.headers['user-agent'] || '';

    // For regular browsers: redirect immediately to Angular frontend.
    // For crawlers: serve the OG meta page (they don't follow JS redirects).
    const redirectScript = isCrawler(ua) ? '' : `
    <script>window.location.replace(${JSON.stringify(canonicalUrl)});</script>
    <noscript><meta http-equiv="refresh" content="0;url=${ogUrl}"></noscript>`;

    const html = `<!DOCTYPE html>
<html lang="pt" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="utf-8">
  <title>${ogTitle}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${ogDescription}">
  <meta name="robots" content="noindex, follow">

  <!-- Open Graph -->
  <meta property="og:type"        content="website">
  <meta property="og:site_name"   content="${SITE_NAME}">
  <meta property="og:locale"      content="pt_PT">
  <meta property="og:title"       content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:url"         content="${ogUrl}">
  <meta property="og:image"       content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter / X -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@bidroompt">
  <meta name="twitter:title"       content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image"       content="${ogImage}">

  <link rel="canonical" href="${ogUrl}">
  ${redirectScript}
</head>
<body style="font-family:sans-serif;background:#0a0a0a;color:#f0ede8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center;padding:32px">
    <p style="color:#888;font-size:14px">A redirecionar para BidRoom…</p>
    <a href="${ogUrl}" style="color:#c9a84c;font-size:13px">Clique aqui se não for redireccionado</a>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cache briefly so bots don't hammer the DB, but not too long (prices change)
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120');
    res.send(html);
  } catch (err) {
    console.error('[share] Error:', err.message);
    res.redirect(302, `${FRONTEND}/listing/${req.params.slug}`);
  }
});

module.exports = router;
