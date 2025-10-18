export interface PreAuthRequest {
  amount: number;
  currency: string;
  auctionId?: string;
}

export interface PreAuthResponse {
  clientSecret: string;
  preAuthId: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface ConfirmPreAuthRequest {
  paymentMethodId: string;
}

export interface BiddingTierRequest {
  tier: 'basic' | 'verified' | 'premium';
}

export interface CanBidRequest {
  auctionId: string;
  bidAmount: number;
}

export interface CanBidResponse {
  canBid: boolean;
  reason?: string;
}
