/**
 * API Configuration
 * Determines the API URL based on the environment:
 * - Local: http://localhost:3000/api (when running on localhost)
 * - Dev: https://bidroom-backend-dev.azurewebsites.net/api (when running on Azure Static Web Apps)
 */
export const API_CONFIG = {
  getApiUrl(): string {
    // Check for environment variable (set via Azure Static Web App configuration)
    if (typeof window !== 'undefined' && (window as any).APP_CONFIG?.API_URL) {
      return (window as any).APP_CONFIG.API_URL;
    }
    
    // Check for process.env (for build-time configuration)
    const envApiUrl = (window as any).process?.env?.['NG_APP_API_URL'];
    if (envApiUrl) {
      return envApiUrl;
    }
    
    // Detect environment based on hostname
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    
    // Local development: use local backend
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return 'http://localhost:3000/api';
    }
    
    // Azure Static Web Apps (DEV environment): use Azure dev backend
    // Any other hostname (including *.azurestaticapps.net) uses the dev backend
    return 'https://bidroom-backend-dev.azurewebsites.net/api';
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

