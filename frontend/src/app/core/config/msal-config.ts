import { Configuration, PopupRequest, RedirectRequest, InteractionType } from '@azure/msal-browser';
import { environment } from '@environments/environment';

// MSAL configuration for Azure AD (Regular)
export const msalConfig: Configuration = {
  auth: {
    clientId: environment.azureAdB2C.clientId,
    authority: `https://login.microsoftonline.com/${environment.azureAdB2C.tenantId}`,
    knownAuthorities: [`login.microsoftonline.com`],
    redirectUri: environment.azureAdB2C.redirectUri,
    postLogoutRedirectUri: environment.azureAdB2C.postLogoutRedirectUri,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) {
          return;
        }
        switch (level) {
          case 0: // LogLevel.Error
            console.error(message);
            break;
          case 1: // LogLevel.Warning
            console.warn(message);
            break;
          case 2: // LogLevel.Info
            console.info(message);
            break;
          case 3: // LogLevel.Verbose
            console.debug(message);
            break;
        }
      },
      piiLoggingEnabled: false,
    },
    windowHashTimeout: 60000,
    iframeHashTimeout: 6000,
    loadFrameTimeout: 0,
  },
};

// Scopes for API access
export const apiConfig = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
  uri: environment.apiUrl,
};

// Login request configuration
export const loginRequest: PopupRequest | RedirectRequest = {
  scopes: apiConfig.scopes,
  prompt: 'select_account',
};

// Silent request configuration for token renewal
export const silentRequest = {
  scopes: apiConfig.scopes,
  account: null, // Will be set dynamically
};

// Logout request configuration
export const logoutRequest = {
  postLogoutRedirectUri: environment.azureAdB2C.postLogoutRedirectUri,
};

// Guard configuration
export const guardConfig = {
  interactionType: InteractionType.Redirect as InteractionType.Redirect,
  authRequest: loginRequest,
};

// Interceptor configuration
export const interceptorConfig = {
  interactionType: InteractionType.Redirect as InteractionType.Redirect,
  protectedResourceMap: new Map([
    // Only protect specific authenticated endpoints
    [`${environment.apiUrl}/auth/sync`, apiConfig.scopes],
    [`${environment.apiUrl}/user`, apiConfig.scopes],
    [`${environment.apiUrl}/auctions`, apiConfig.scopes],
    [`${environment.apiUrl}/bids`, apiConfig.scopes],
    [`${environment.apiUrl}/transactions`, apiConfig.scopes],
    [`${environment.apiUrl}/dashboard`, apiConfig.scopes],
  ]),
};
