/**
 * API Configuration
 * - Local (ng serve):  /api via proxy.conf.json → backend (avoids CORS)
 * - Deployed (SWA):    full backend URL — same-origin /api only serves index.html
 * - Override:          window.APP_CONFIG.API_URL (absolute URL on deploy)
 */
import { environment } from '@env';

function normalizeApiUrl(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

function apiUrlFromEnvironment(): string {
  const base = environment.defaultApiBaseUrl.replace(/\/$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}

export const API_CONFIG = {
  getApiUrl(): string {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const isLocal = isLocalHost(hostname);
    const runtimeUrl =
      typeof window !== 'undefined' ? (window as { APP_CONFIG?: { API_URL?: string } }).APP_CONFIG?.API_URL : undefined;

    if (isLocal) {
      // ng serve + proxy.conf.json; allow absolute override for direct backend testing
      if (runtimeUrl && (runtimeUrl.startsWith('http://') || runtimeUrl.startsWith('https://'))) {
        return normalizeApiUrl(runtimeUrl);
      }
      return '/api';
    }

    // Azure Static Web Apps (and similar): never use same-origin /api — SPA fallback returns HTML
    if (runtimeUrl && (runtimeUrl.startsWith('http://') || runtimeUrl.startsWith('https://'))) {
      return normalizeApiUrl(runtimeUrl);
    }

    return apiUrlFromEnvironment();
  },

  /** Origin of the backend (no /api) — for Socket.IO */
  getBackendBaseUrl(): string {
    const cfg =
      typeof window !== 'undefined'
        ? (window as { APP_CONFIG?: { BACKEND_ORIGIN?: string } }).APP_CONFIG
        : undefined;
    if (cfg?.BACKEND_ORIGIN) {
      return cfg.BACKEND_ORIGIN.replace(/\/$/, '');
    }

    const api = this.getApiUrl();
    if (api.startsWith('http://') || api.startsWith('https://')) {
      return api.replace(/\/api\/?$/, '');
    }

    // localhost + /api proxy
    if (typeof window !== 'undefined' && isLocalHost(window.location.hostname)) {
      return window.location.origin;
    }

    return environment.defaultApiBaseUrl.replace(/\/$/, '').replace(/\/api\/?$/, '');
  },

  getStripePublishableKey(): string {
    const runtimeKey = typeof window !== 'undefined' && (window as any).APP_CONFIG?.STRIPE_PUBLISHABLE_KEY;
    if (runtimeKey) return runtimeKey;

    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return 'pk_test_51TI5X806hw2O8NlNioZFt34bFn38uQPhm4hayUKZtrPf41BWH4xxdjiox9gNlMpSSHdUfCYtAM5FNX1UF3KyhNuP00Vqz8RtvH';
    }

    console.warn('[BidRoom] STRIPE_PUBLISHABLE_KEY not configured via APP_CONFIG. Set window.APP_CONFIG.STRIPE_PUBLISHABLE_KEY at deploy time.');
    return '';
  }
};
