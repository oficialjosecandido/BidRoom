const express = require('express');
const router  = express.Router();
const Listing = require('../models/Listing');

const BASE_URL = 'https://www.bidroom.pt';

const STATIC_PAGES = [
  { path: '',              changefreq: 'weekly',  priority: '1.0' },
  { path: 'listings',     changefreq: 'hourly',  priority: '0.9' },
  { path: 'how-it-works', changefreq: 'monthly', priority: '0.7' },
  { path: 'trust',        changefreq: 'monthly', priority: '0.6' },
];

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod   ? `    <lastmod>${lastmod}</lastmod>`         : '',
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : '',
    priority   ? `    <priority>${priority}</priority>`       : '',
    '  </url>',
  ].filter(Boolean).join('\n');
}

// GET /sitemap.xml
// The SWA has no linked backend, so www.bidroom.pt/sitemap.xml is a 301
// redirect (staticwebapp.config.json) straight to this backend route.
router.get('/', async (req, res) => {
  try {
    const listings = await Listing
      .find({ status: 'active' })
      .select('slug updatedAt category')
      .sort({ updatedAt: -1 })
      .limit(50_000)
      .lean();

    const staticEntries = STATIC_PAGES.map(p =>
      urlEntry({
        loc:        `${BASE_URL}/${p.path}`,
        changefreq: p.changefreq,
        priority:   p.priority,
      })
    );

    const listingEntries = listings.map(l =>
      urlEntry({
        loc:        `${BASE_URL}/listing/${l.slug}`,
        lastmod:    new Date(l.updatedAt).toISOString().slice(0, 10),
        changefreq: 'hourly',
        priority:   '0.9',
      })
    );

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...staticEntries,
      ...listingEntries,
      '</urlset>',
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 h — crawlers don't need real-time
    res.send(xml);
  } catch (err) {
    res.status(500).send('<?xml version="1.0"?><error>Sitemap generation failed</error>');
  }
});

module.exports = router;
