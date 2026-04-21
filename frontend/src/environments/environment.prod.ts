export const environment = {
  production: true,
  defaultApiBaseUrl: 'https://bidroom-backend-dev.azurewebsites.net/api',
  bidroomFeeSellerRate: 0.005,
  bidroomFeeBuyerRate: 0.005,
  auctionDurations: [
    { label: '1 hour',   hours: 1  },
    { label: '7 hours',  hours: 7  },
    { label: '24 hours', hours: 24 },
  ],
  shippingOptions: [
    { label: 'Flat Rate',    value: 'flat-rate'    },
    { label: 'Calculated',   value: 'calculated'   },
    { label: 'Meet in Person', value: 'local-pickup' },
    { label: 'Free',         value: 'free'         },
  ],
  handlingTimes: [
    { label: '1 day',  value: 1 },
    { label: '2 days', value: 2 },
    { label: '3 days', value: 3 },
    { label: '5 days', value: 5 },
    { label: '7 days', value: 7 },
  ],
  returnPolicies: [
    { label: '30 days',    value: '30-days'    },
    { label: '14 days',    value: '14-days'    },
    { label: 'No Returns', value: 'no-returns' },
    { label: 'Custom',     value: 'custom'     },
  ],
  featureFlags: {
    auctions:        true,
    privateRooms:    true,
    bestOffers:      true,
    reviews:         true,
    membershipTiers: false,
  },
  theme: {
    primaryColor:    '#002366',
    secondaryColor:  '#00D4FF',
    backgroundColor: '#F8FAFC',
  },
};
