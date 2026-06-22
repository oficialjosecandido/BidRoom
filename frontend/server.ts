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
});

// Sitemap is generated dynamically by the backend from live listing data —
// redirect before express.static can serve a stale cached copy (maxAge: '1y' below).
app.get('/sitemap.xml', (req, res) => {
  res.redirect(301, 'https://bidroom-backend-prod-e9eghtc0aha4e3dw.uksouth-01.azurewebsites.net/sitemap.xml');
});

// TEMP diagnostic — remove after debugging the empty-SSR-output issue on /listing/:slug.
app.get('/__debug/backend-check', async (req, res) => {
  const url = 'https://bidroom-backend-prod-e9eghtc0aha4e3dw.uksouth-01.azurewebsites.net/api/listings/slug/rolex-datejust-blue-dial-41mm-2026';
  const started = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await r.text();
    res.json({
      ok: true,
      status: r.status,
      ms: Date.now() - started,
      nodeVersion: process.version,
      bodyLength: body.length,
      bodySnippet: body.slice(0, 150),
    });
  } catch (err) {
    res.json({
      ok: false,
      ms: Date.now() - started,
      nodeVersion: process.version,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
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
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
      if (response) {
        writeResponseToNodeResponse(response, res);
      } else {
        // No Angular route matched — send to landing page
        res.redirect(302, '/landing');
      }
    })
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
