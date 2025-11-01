/**
 * API Configuration
 * Determines the API URL based on the environment
 */
export const API_CONFIG = {
  // Get API URL from environment or use defaults
  // In production, this should be set via environment variables
  // For Azure Static Web Apps, you can set this via Azure Portal application settings
  getApiUrl(): string {
    // Check for environment variable (set via Azure Static Web App configuration)
    if (typeof window !== 'undefined' && (window as any).APP_CONFIG?.API_URL) {
      return (window as any).APP_CONFIG.API_URL;
    }
    
    // Check for process.env (for build-time configuration)
    // In Angular, you can use environment files, but for Azure Static Web Apps,
    // runtime configuration is more flexible
    const envApiUrl = (window as any).process?.env?.['NG_APP_API_URL'];
    if (envApiUrl) {
      return envApiUrl;
    }
    
    // Default: Use Azure backend URL for production, localhost for development
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000/api';
    }
    
    // Production default - Azure App Service
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

