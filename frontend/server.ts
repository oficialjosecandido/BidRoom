import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();

// SSRF protection: only these hosts may appear in the request's Host header during SSR.
// Extend at runtime by setting NG_ALLOWED_HOSTS (comma-separated) in App Service settings.
const extraHosts = (process.env['NG_ALLOWED_HOSTS'] ?? '')
  .split(',').map(h => h.trim()).filter(Boolean);
const angularApp = new AngularNodeAppEngine({
  allowedHosts: ['localhost', '127.0.0.1', 'www.bidroom.pt', 'bidroom.pt', ...extraHosts],
  // Azure App Service always sits behind its own load balancer, so every
  // request arrives with x-forwarded-* headers. `true` only trusts the
  // engine's built-in set (for/host/port/proto/prefix) — Azure also sends
  // a non-standard "x-forwarded-tlsversion" header, which isn't in that
  // set, so the engine deopted to the client-only shell on every single
  // request regardless. Listing the exact headers Azure sends fixes it.
  trustProxyHeaders: ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto', 'x-forwarded-prefix', 'x-forwarded-tlsversion'],
});

// Sitemap is generated dynamically by the backend from live listing data.
// Proxied transparently so Google sees a 200 at www.bidroom.pt/sitemap.xml
// instead of a 301 redirect (which it flags as a non-indexable page).
app.get('/sitemap.xml', async (_req, res) => {
  try {
    const backendSitemapUrl = process.env['BACKEND_SITEMAP_URL']
      || 'https://bidroom-backend-prod-e9eghtc0aha4e3dw.uksouth-01.azurewebsites.net/sitemap.xml';
    const upstream = await fetch(backendSitemapUrl, { signal: AbortSignal.timeout(8000) });
    const xml = await upstream.text();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(xml);
  } catch {
    res.status(503).send('<?xml version="1.0"?><error>Sitemap temporarily unavailable</error>');
  }
});

// Serve static files from /browser
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// All regular routes use the Angular engine.
// No path pattern needed — Express 5 uses path-to-regexp v8 which rejects unnamed wildcards (/**).
// If Angular returns no response (unmatched route), redirect to landing.
// Must be a native async function — Express 5 logs "Promise-like handlers are
// deprecated" for a .then()/.catch() chain and does not reliably await it,
// which was silently falling through to the static index.csr.html shell.
app.use(async (req, res, next) => {
  try {
    const response = await angularApp.handle(req);
    if (response) {
      writeResponseToNodeResponse(response, res);
    } else {
      // No Angular route matched — real 404 (avoid Soft 404 / redirect loops for crawlers).
      res.status(404).type('html').send(`<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"><title>404 · BidRoom</title>
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem;color:#1d1d1f">
<h1 style="font-size:1.5rem">Página não encontrada</h1>
<p style="color:#6e6e73">O endereço que pediu não existe ou foi removido.</p>
<p><a href="/" style="color:#8C6B1E">Voltar ao BidRoom</a></p>
</body></html>`);
    }
  } catch (err) {
    next(err);
  }
});

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
