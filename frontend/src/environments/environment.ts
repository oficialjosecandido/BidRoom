export const environment = {
  production: false,
  apiUrl: 'http://localhost:3001/api/v1',
  socketUrl: 'http://localhost:3001',
  
  azureAdB2C: {
    clientId: '830113ac-5e1d-4a08-98d7-3866d90c2402',
    tenantId: '6bc814b0-8864-453f-9e97-21c0a41de7bc',
    authority: 'https://login.microsoftonline.com/6bc814b0-8864-453f-9e97-21c0a41de7bc',
    redirectUri: 'http://localhost:4201/auth-callback',
    postLogoutRedirectUri: 'http://localhost:4201',
    knownAuthorities: ['login.microsoftonline.com'],
  },
};

