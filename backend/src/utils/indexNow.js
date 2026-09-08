const logger = require('./logger');

// IndexNow key: a public verification token (not a secret), proven by hosting
// a matching <key>.txt at the site root — see frontend/public/d197b84e6a113b17c9e7050241baf760.txt
const INDEXNOW_KEY = 'd197b84e6a113b17c9e7050241baf760';
const INDEXNOW_HOST = 'www.bidroom.pt';

// Notifies IndexNow-participating search engines (Bing, Yandex, etc.) that a
// listing URL is newly live, instead of waiting for the next sitemap crawl.
async function submitListingUrl(slug) {
  if (!slug) return;
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
        urlList: [`https://${INDEXNOW_HOST}/listing/${slug}`]
      }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (err) {
    logger.warn('IndexNow submit failed', { slug, error: err.message });
  }
}

module.exports = { submitListingUrl };
