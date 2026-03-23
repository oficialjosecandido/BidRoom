export const environment = {
  production: false,
  /** Seller commission rate (0.005 = 0.5%, 0.05 = 5%) */
  bidroomFeeSellerRate: 0.005,
  /** Buyer fee rate (0.005 = 0.5%, 0.05 = 5%) */
  bidroomFeeBuyerRate: 0.005,
  auctionDurations: [
    { label: '5 minutes', hours: 1 / 12 },
    { label: '1 hour',    hours: 1      },
    { label: '7 hours',   hours: 7      },
    { label: '24 hours',  hours: 24     },
  ],
};
