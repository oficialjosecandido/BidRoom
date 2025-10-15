export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1',
  socketUrl: 'http://localhost:3000',
  
  azureAdB2C: {
    clientId: 'YOUR_AZURE_AD_B2C_CLIENT_ID',
    authority: 'https://YOUR_TENANT.b2clogin.com/YOUR_TENANT.onmicrosoft.com/B2C_1_signupsignin',
    redirectUri: 'http://localhost:4200/auth/callback',
    postLogoutRedirectUri: 'http://localhost:4200',
    knownAuthorities: ['YOUR_TENANT.b2clogin.com'],
  },
};

