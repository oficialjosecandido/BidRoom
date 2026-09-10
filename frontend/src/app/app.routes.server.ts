import { RenderMode, ServerRoute } from '@angular/ssr';

// Apenas as rotas que precisam de SSR (OG tags / SEO) são listadas explicitamente.
// Tudo o resto (dashboard, auth, nexus, private-room, etc.) cai no catch-all
// e continua a ser renderizado no cliente exatamente como hoje (sem SSR).
export const serverRoutes: ServerRoute[] = [
  { path: '',                          renderMode: RenderMode.Server },
  { path: 'landing/how-it-works',      renderMode: RenderMode.Server },
  { path: 'landing/faq',               renderMode: RenderMode.Server },
  { path: 'landing/trust',             renderMode: RenderMode.Server },
  { path: 'landing/contact',           renderMode: RenderMode.Server },
  { path: 'landing/privacy-policy',    renderMode: RenderMode.Server },
  { path: 'landing/cookies',           renderMode: RenderMode.Server },
  { path: 'landing/terms-conditions',  renderMode: RenderMode.Server },
  { path: 'listing/:slug',             renderMode: RenderMode.Server },
  { path: 'seller/:id',                renderMode: RenderMode.Server },
  { path: 'notifications/unsubscribe', renderMode: RenderMode.Server },
  { path: 'blog',                      renderMode: RenderMode.Server },
  { path: 'blog/:slug',                renderMode: RenderMode.Server },
  { path: '**',                        renderMode: RenderMode.Client },
];
