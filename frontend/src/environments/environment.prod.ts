export const environment = {
  production: true,
  /** When APP_CONFIG.API_URL is not injected — set to your production API base */
  defaultApiBaseUrl: 'https://bidroom-backend.azurewebsites.net/api',
  auctionDurations: [
    { label: '5 minutes', hours: 1 / 12 },
    { label: '1 hour',   hours: 1  },
    { label: '7 hours',  hours: 7  },
    { label: '24 hours', hours: 24 },
  ],
  shippingOptions: [
    { label: 'Flat Rate', value: 'flat-rate' },
    { label: 'Calculated', value: 'calculated' },
    { label: 'Local Pickup', value: 'local-pickup' },
    { label: 'Free', value: 'free' },
  ],
  handlingTimes: [
    { label: '1 day', value: 1 },
    { label: '2 days', value: 2 },
    { label: '3 days', value: 3 },
    { label: '5 days', value: 5 },
    { label: '7 days', value: 7 },
  ],
  returnPolicies: [
    { label: '30 days', value: '30-days' },
    { label: '14 days', value: '14-days' },
    { label: 'No Returns', value: 'no-returns' },
    { label: 'Custom', value: 'custom' },
  ],
  /** Seller commission rate (0.005 = 0.5%, 0.02 = 2% for private room) */
  bidroomFeeSellerRate: 0.005,
  /** Buyer fee rate (0.005 = 0.5%, 0.05 = 5%) */
  bidroomFeeBuyerRate: 0.005,
};
