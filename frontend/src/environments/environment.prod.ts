export const environment = {
  production: true,
  apiUrl: 'https://api.bidroom.co/api/v1',
  socketUrl: 'https://api.bidroom.co',
  
  azureAdB2C: {
    clientId: 'YOUR_AZURE_AD_B2C_CLIENT_ID',
    authority: 'https://YOUR_TENANT.b2clogin.com/YOUR_TENANT.onmicrosoft.com/B2C_1_signupsignin',
    redirectUri: 'https://www.bidroom.co/auth/callback',
    postLogoutRedirectUri: 'https://www.bidroom.co',
    knownAuthorities: ['YOUR_TENANT.b2clogin.com'],
  },
};

