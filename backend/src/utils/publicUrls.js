const logger = require('./logger');

const PRODUCTION_URL = 'https://www.bidroom.pt';

let warned = false;

/**
 * Base URL for links that leave the platform — emails, social posts, anything
 * a person opens somewhere else.
 *
 * FRONTEND_URL is localhost in development, and that is correct for redirects
 * and CORS. It is wrong for outbound links: a recipient's browser resolves
 * localhost to their own machine, so the link silently leads nowhere. Any
 * script run locally against the production database would otherwise send out
 * links to localhost.
 *
 * SOCIAL_PUBLIC_URL, then FRONTEND_URL_PROD, then FRONTEND_URL when it is not
 * local, and the production domain as the last resort.
 */
function publicBaseUrl() {
  const isLocal = url => /localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(?::|$)/i.test(url);

  const candidates = [
    process.env.SOCIAL_PUBLIC_URL,
    process.env.FRONTEND_URL_PROD,
    process.env.FRONTEND_URL
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && !isLocal(value)) return value.replace(/\/$/, '');
  }

  if (!warned) {
    warned = true;
    logger.warn(
      `[publicUrls] No non-local frontend URL configured — outbound links fall back to ${PRODUCTION_URL}. ` +
      'Set SOCIAL_PUBLIC_URL or FRONTEND_URL_PROD.'
    );
  }
  return PRODUCTION_URL;
}

module.exports = { publicBaseUrl, PRODUCTION_URL };
