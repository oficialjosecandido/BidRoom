export const environment = {
  production: true,
  defaultApiBaseUrl: 'https://bidroom-backend-dev.azurewebsites.net',
  // defaultApiBaseUrl: 'https://bidroom-backend-dev.azurewebsites.net/api',
  /** Seller fee: 3.5% for auctions & best-offer, 6% for private-room auctions */
  bidroomFeeSellerRate: 0.035,
  bidroomFeePrivateRoomRate: 0.06,
  /** Buyer pays Stripe processing fees only — no additional BidRoom buyer fee */
  bidroomFeeBuyerRate: 0,
  auctionDurations: [
    { label: '5 minutes', hours: 1 / 12 },
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
