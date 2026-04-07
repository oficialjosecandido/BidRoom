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

  /** Airwallex environment: 'demo' or 'production' (read from window.APP_CONFIG at runtime) */
  getAirwallexEnv(): string {
    const runtimeEnv = typeof window !== 'undefined' && (window as any).APP_CONFIG?.AIRWALLEX_ENV;
    return runtimeEnv || 'demo';
  }
};
