export const environment = {
  production: true,
  apiUrl: 'https://api.bidroom.co/api/v1',
  socketUrl: 'https://api.bidroom.co',
  
  azureAdB2C: {
    clientId: '830113ac-5e1d-4a08-98d7-3866d90c2402',
    tenantId: '6bc814b0-8864-453f-9e97-21c0a41de7bc',
    authority: 'https://login.microsoftonline.com/6bc814b0-8864-453f-9e97-21c0a41de7bc',
    redirectUri: 'https://www.bidroom.co/auth/callback',
    postLogoutRedirectUri: 'https://www.bidroom.co',
    knownAuthorities: ['login.microsoftonline.com'],
  },
};

