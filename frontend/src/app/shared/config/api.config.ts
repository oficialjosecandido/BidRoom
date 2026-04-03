/**
 * API Configuration
 * Determines the API URL and Stripe key based on the environment:
 * - Local:      http://localhost:3000/api
 * - Dev/Prod:   set via window.APP_CONFIG injected in index.html
 *
 * For Azure Static Web Apps, populate APP_CONFIG in index.html at deploy time
 * using your CI/CD pipeline (token substitution or a startup script).
 * Required values:
 *   window.APP_CONFIG.API_URL               — backend API base URL
 *   window.APP_CONFIG.STRIPE_PUBLISHABLE_KEY — pk_live_... or pk_test_...
 */

const PROD_HOSTNAME = 'bidroom.com'; // update to the actual production domain

export const API_CONFIG = {
  getApiUrl(): string {
    // Runtime injection (preferred — set per environment in CI/CD)
    const runtimeUrl = typeof window !== 'undefined' && (window as any).APP_CONFIG?.API_URL;
    if (runtimeUrl) return runtimeUrl;

    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return 'http://localhost:3000/api';
    }

    if (hostname === PROD_HOSTNAME || hostname === `www.${PROD_HOSTNAME}`) {
      return 'https://bidroom-backend.azurewebsites.net/api';
    }

    // All other hostnames (*.azurestaticapps.net, PR previews, etc.) → dev backend
    return 'https://bidroom-backend-dev.azurewebsites.net/api';
  },

  getStripePublishableKey(): string {
    // Runtime injection (preferred — set per environment in CI/CD)
    const runtimeKey = typeof window !== 'undefined' && (window as any).APP_CONFIG?.STRIPE_PUBLISHABLE_KEY;
    if (runtimeKey) return runtimeKey;

    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

    // Only use the test key for localhost; all deployed environments must inject via APP_CONFIG
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return 'pk_test_51T98Ps1Me1kcdayq7UjnAMHVW88Blkx2MCBtwMvCL7XLmTBxb59PrSwhxSIJY8qrDiJBpbRY9YwHGPKGSOULrSzk00Mmg5sYh5';
    }

    // Non-localhost with no APP_CONFIG injection → log a warning and return empty
    // This will cause Stripe to fail loudly rather than silently use a test key in production
    console.warn('[BidRoom] STRIPE_PUBLISHABLE_KEY not configured via APP_CONFIG. Set window.APP_CONFIG.STRIPE_PUBLISHABLE_KEY at deploy time.');
    return '';
  },

  getWebSocketUrl(): string {
    const apiUrl = this.getApiUrl();
    // Remove /api suffix if present
    const baseUrl = apiUrl.replace('/api', '');
    
    // Convert http to ws or https to wss
    if (baseUrl.startsWith('https://')) {
      return baseUrl.replace('https://', 'wss://');
    } else if (baseUrl.startsWith('http://')) {
      return baseUrl.replace('http://', 'ws://');
    }
    
    return baseUrl;
  }
};

