/**
 * Proxies /api/share/listing/:slug on www.bidroom.pt to the backend OG page.
 * WhatsApp/Facebook crawlers need server-rendered HTML — the Angular SPA cannot provide it.
 */
const BACKEND_ORIGIN = (process.env.BACKEND_ORIGIN || 'https://bidroom-backend-dev.azurewebsites.net').replace(/\/$/, '');

module.exports = async function (context, req) {
  const slug = context.bindingData.slug;
  if (!slug) {
    context.res = { status: 400, body: 'Missing slug' };
    return;
  }

  const target = `${BACKEND_ORIGIN}/share/listing/${encodeURIComponent(slug)}`;
  const forwardHeaders = {
    'user-agent': req.headers['user-agent'] || '',
    'accept-language': req.headers['accept-language'] || '',
    'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers['host'] || '',
    'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'https'
  };

  try {
    const upstream = await fetch(target, { headers: forwardHeaders });
    const body = await upstream.text();
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    const cache = upstream.headers.get('cache-control');
    if (cache) headers['Cache-Control'] = cache;

    context.res = { status: upstream.status, headers, body };
  } catch (err) {
    context.log.error('share-listing proxy failed', err);
    context.res = {
      status: 302,
      headers: { Location: `/listing/${slug}` }
    };
  }
};
