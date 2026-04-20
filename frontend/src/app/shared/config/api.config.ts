/**
 * API Configuration
 * - Local:      http://localhost:3000/api
 * - Deployed:   Prefer window.APP_CONFIG.API_URL (set in index.html / CI)
 * - Fallback:   environment.defaultApiBaseUrl (dev vs prod from Angular fileReplacements)
 */
import { environment } from '@env';

export const API_CONFIG = {
  getApiUrl(): string {
    const runtimeUrl = typeof window !== 'undefined' && (window as any).APP_CONFIG?.API_URL;
    if (runtimeUrl) return runtimeUrl;

    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return 'http://localhost:3000/api';
    }

    return environment.defaultApiBaseUrl;
  },

  /** Origin of the backend (no /api) — for Socket.IO */
  getBackendBaseUrl(): string {
    return this.getApiUrl().replace(/\/api\/?$/, '');
  },

  getStripePublishableKey(): string {
    const runtimeKey = typeof window !== 'undefined' && (window as any).APP_CONFIG?.STRIPE_PUBLISHABLE_KEY;
    if (runtimeKey) return runtimeKey;

    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return 'pk_test_51T98Ps1Me1kcdayq7UjnAMHVW88Blkx2MCBtwMvCL7XLmTBxb59PrSwhxSIJY8qrDiJBpbRY9YwHGPKGSOULrSzk00Mmg5sYh5';
    }

    console.warn('[BidRoom] STRIPE_PUBLISHABLE_KEY not configured via APP_CONFIG. Set window.APP_CONFIG.STRIPE_PUBLISHABLE_KEY at deploy time.');
    return '';
  }
};
