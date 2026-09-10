const crypto = require('crypto');

/**
 * Open tracking for admin-sent emails.
 *
 * We send through Gmail SMTP, which reports nothing back about opens, so the
 * only signal available is a 1x1 image the client fetches when it renders the
 * message. Treat the numbers as a floor with noise, not as truth:
 *
 *  - a recipient who blocks remote images never counts as an open;
 *  - Apple Mail Privacy Protection (and, to a lesser extent, Gmail's image
 *    proxy) pre-fetches images whether or not a human looked at the message,
 *    which inflates the count.
 *
 * Sends are still worth comparing against each other; the absolute rate is not
 * worth reading closely.
 */

/** 1x1 fully transparent GIF. */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function newTrackingToken() {
  return crypto.randomBytes(16).toString('hex');
}

/** Public origin of THIS backend — the pixel is served by the API, not the SPA. */
function backendBaseUrl() {
  return (
    process.env.BACKEND_PUBLIC_URL ||
    'https://bidroom-backend-prod-e9eghtc0aha4e3dw.uksouth-01.azurewebsites.net'
  ).replace(/\/$/, '');
}

function trackingPixelUrl(token) {
  return `${backendBaseUrl()}/api/email-track/open.gif?t=${token}`;
}

/**
 * Appends the tracking pixel to an email body.
 *
 * Placed just before </body> when there is one so it inherits the document,
 * and appended otherwise — many of these templates are HTML fragments.
 */
function injectTrackingPixel(html, token) {
  const img =
    `<img src="${trackingPixelUrl(token)}" width="1" height="1" alt="" ` +
    `style="display:block;width:1px;height:1px;border:0;outline:none" />`;

  const closingBody = /<\/body\s*>/i;
  if (closingBody.test(html)) {
    return html.replace(closingBody, match => `${img}${match}`);
  }
  return `${html}${img}`;
}

module.exports = {
  PIXEL,
  newTrackingToken,
  trackingPixelUrl,
  injectTrackingPixel
};
