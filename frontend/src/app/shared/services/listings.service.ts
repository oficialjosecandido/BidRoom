import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface Listing {
  _id: string;
  slug: string;
  title: string;
  description: string;
  titlePt?: string | null;
  titleEn?: string | null;
  descriptionPt?: string | null;
  descriptionEn?: string | null;
  category: string;
  subCategory?: string;
  images: string[];
  startingPrice: number;
  currentPrice: number;
  buyNowPrice?: number;
  bidIncrement: number;
  bidCount: number;
  startDate: string;
  endDate: string;
  seller: {
    _id: string;
    slug?: string | null;
    firstName: string;
    lastName: string;
    email: string;
    uid?: string;
    sellerClassification?: 'private' | 'professional';
    professionalVerificationStatus?: 'none' | 'pending' | 'verified' | 'rejected';
    professionalLegalName?: string | null;
    professionalTradeName?: string | null;
    professionalAddressLine1?: string | null;
    professionalAddressLine2?: string | null;
    professionalCity?: string | null;
    professionalRegion?: string | null;
    professionalPostalCode?: string | null;
    professionalCountry?: string | null;
    professionalContactPhone?: string | null;
    professionalContactEmail?: string | null;
    professionalVatId?: string | null;
  };
  status: 'draft' | 'active' | 'pending_review' | 'ended' | 'cancelled';
  moderationWarning?: { severity: 'low' | 'medium' | 'high'; message: string; flaggedAt: string };
  isFeatured: boolean;
  isVerified: boolean;
  verificationDetails?: string;
  listingType: 'Promoted' | 'Verified' | 'Standard';
  condition: string;
  location?: string;
  locationCity?: string;
  locationCountry?: string;
  shippingCost: number;
  shippingOption?: string;
  returnPolicy?: string;
  handlingTime?: number;
  specifications?: { key: string; value: string }[];
  // New auction mechanics
  auctionFormat: 'highest-bid' | 'best-offer';
  durationSlot: '5 minutes' | '2 hours' | '24 hours' | '3 days' | '7 days';
  allowPrivateRoom: boolean;
  commissionRate: number;
  privateRoomStatus?: 'not-triggered' | 'eligible' | 'invited' | 'active' | 'ended';
  privateRoomClosedReason?: 'no_acceptances' | 'seller_left' | 'time_expired' | 'non_payment_no_second_bidder' | null;
  privateRoomEndDate?: string;
  privateRoomLastBidTime?: string;
  platinumBidders?: string[] | { _id: string; firstName: string; lastName: string; email: string }[];
  platinumBidderInvitedAt?: string;
  platinumBidderAcceptanceDeadline?: string;
  currentUserPlatinumStatus?: { isPlatinumBidder: boolean; invitationPending?: boolean };
  platinumBidderStatus?: {
    bidder: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
    status: 'pending' | 'accepted' | 'declined';
    invitedAt: string;
    acceptedAt?: string | null;
  }[];
  minimumOfferPrice?: number; // For Best Offer format
  renewalRequired?: boolean;
  uniqueBidders?: string[];
  winner?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  winnerBid?: string;
  winnerSelectedAt?: string;
  winnerSelectionDeadline?: string;
  // Relist tracking
  autoRelist?: boolean;
  relistCount?: number;
  relistOf?: string | null;
  relistedAt?: string | null;
  timeRemaining?: {
    ended: boolean;
    days: number;
    hours: number;
    minutes: number;
    totalMs: number;
  };
  endingSoon?: boolean;
  createdAt: string;
  updatedAt: string;
  watchlistCount?: number;
  inWatchlist?: boolean;
  /** Set on seller/my-listings: highest offer received (pending or accepted) */
  highestOfferAmount?: number | null;
  /** Seller's average rating as seller (from reviews) */
  sellerScore?: number | null;
  /** Number of reviews the seller has received as seller */
  sellerReviewCount?: number;
  /** Set on bidder/my-auctions: user's highest bid on this listing */
  myHighestBid?: number | null;
  /** Set on bidder/my-auctions: when user last bid */
  myLastBidAt?: string | null;
  /** Set on bidder/my-auctions: preference for outbid notifications (email + in-app when logged in) */
  notifyWhenOutbid?: boolean;
  itemMode?: 'single' | 'bundle' | 'multi_quantity';
  quantity?: number;
  bundleItems?: { title: string; description?: string }[];
}

export interface ListingsResponse {
  listings: Listing[];
  total: number;
  limit: number;
  skip: number;
  page: number;
  totalPages: number;
}

export interface ListingsQueryParams {
  category?: string;
  subCategory?: string;
  sort?: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' | 'recent-end';
  minPrice?: number;
  maxPrice?: number;
  minBids?: number;
  listingType?: 'Promoted' | 'Verified' | 'Standard';
  status?: string;
  search?: string;
  /** Comma-separated condition keys: new, like-new, very-good, good, fair, for-parts */
  condition?: string;
  /** Comma-separated shipping options: flat-rate, calculated, local-pickup, free (legacy: worldwide, regional) */
  shipping?: string;
  /** Partial match on listing.location (e.g. "Lisboa, Portugal") */
  location?: string;
  /** @deprecated Use location — kept for legacy URLs */
  locationCity?: string;
  /** @deprecated Use location */
  locationCountry?: string;
  auctionFormat?: 'highest-bid' | 'best-offer';
  allowPrivateRoom?: boolean;
  endingSoon?: boolean;
  isFeatured?: boolean;
  limit?: number;
  skip?: number;
  page?: number;
}

export interface StatsOverview {
  totalBidders: number;
  activeListings: number;
  totalValueTraded: number;
}

export interface SellerAnalyticsListingRow {
  listingId: string;
  title: string;
  slug: string;
  status: string;
  category: string;
  auctionFormat: string;
  cumulativeBidCount: number;
  viewsInRange: number;
  bidEventsInRange: number;
  soldListing: boolean;
  saleActivityInRange: boolean;
}

export interface SellerAnalyticsResponse {
  preset: string;
  range: { from: string; to: string };
  filters: { category: string | null; listingId: string | null };
  overview: {
    totalViews: number;
    totalBidsAndOffers: number;
    salesInRange: number;
    listingsCount: number;
    followersTotal: number;
    followersNewInRange: number;
    conversionPercent: number | null;
  };
  listingCounts: {
    active: number;
    ended: number;
    cancelled: number;
    sold: number;
    totalPublished: number;
  };
  listings: SellerAnalyticsListingRow[];
}

export interface SellerAnalyticsQueryParams {
  preset?: '7d' | '30d' | 'custom';
  from?: string;
  to?: string;
  category?: string;
  listingId?: string;
}

export interface BuyerAnalyticsListingRow {
  listingId: string;
  title: string;
  slug: string;
  status: string;
  category: string;
  auctionFormat: string;
  bidsInRange: number;
  offersInRange: number;
  eventsInRange: number;
  myHighestBid: number | null;
  myHighestOffer: number | null;
  outcome: string;
  purchased: boolean;
  purchaseInRange: boolean;
}

export interface BuyerAnalyticsResponse {
  preset: string;
  range: { from: string; to: string };
  filters: { category: string | null; interaction: string };
  overview: {
    totalBidsInRange: number;
    totalOffersInRange: number;
    purchasesInRange: number;
    totalSpentInRange: number;
    watchlistTotal: number;
    watchlistAddedInRange: number;
    winRatePercent: number | null;
  };
  activityCounts: {
    active: number;
    won: number;
    lost: number;
    pendingPayment: number;
  };
  listings: BuyerAnalyticsListingRow[];
}

export interface BuyerAnalyticsQueryParams {
  preset?: '7d' | '30d' | 'custom';
  from?: string;
  to?: string;
  category?: string;
  interaction?: 'all' | 'bid' | 'offer';
}

@Injectable({
  providedIn: 'root'
})
export class ListingsService {
  private http = inject(HttpClient);

  private get apiUrl(): string {
    return `${API_CONFIG.getApiUrl()}/listings`;
  }

  getListings(params?: ListingsQueryParams): Observable<ListingsResponse> {
    let httpParams = new HttpParams();
    
    if (params) {
      Object.keys(params).forEach(key => {
        const value = params[key as keyof ListingsQueryParams];
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }

    return this.http.get<ListingsResponse>(this.apiUrl, { params: httpParams });
  }

  getListingById(id: string): Observable<Listing> {
    return this.http.get<Listing>(`${this.apiUrl}/${id}`);
  }

  getListingBySlug(slug: string): Observable<Listing> {
    return this.http.get<Listing>(`${this.apiUrl}/slug/${slug}`);
  }

  getStats(): Observable<StatsOverview> {
    return this.http.get<StatsOverview>(`${this.apiUrl}/stats/overview`);
  }

  createListing(listingData: Partial<Listing>): Observable<Listing & { contentWarning?: { severity: string; message: string } }> {
    return this.http.post<Listing & { contentWarning?: { severity: string; message: string } }>(this.apiUrl, listingData);
  }

  validateContent(payload: { title: string; description: string }): Observable<{
    hasContactInfo: boolean;
    types: string[];
    fields: { title: boolean; description: boolean };
  }> {
    return this.http.post<{
      hasContactInfo: boolean;
      types: string[];
      fields: { title: boolean; description: boolean };
    }>(`${this.apiUrl}/validate-content`, payload);
  }

  /** In-progress add-listing snapshot for the current seller (or null). */
  getListingDraft(): Observable<{ draft: { payload: Record<string, unknown>; updatedAt: string } | null }> {
    return this.http.get<{ draft: { payload: Record<string, unknown>; updatedAt: string } | null }>(
      `${this.apiUrl}/drafts/current`
    );
  }

  saveListingDraft(payload: Record<string, unknown>): Observable<{ ok: boolean; updatedAt: string }> {
    return this.http.put<{ ok: boolean; updatedAt: string }>(`${this.apiUrl}/drafts/current`, { payload });
  }

  deleteListingDraft(): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/drafts/current`);
  }

  buyNow(listingId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${listingId}/buy-now`, {});
  }

  getMyListings(): Observable<ListingsResponse> {
    return this.http.get<ListingsResponse>(`${this.apiUrl}/seller/my-listings`);
  }

  getSellerAnalytics(params: SellerAnalyticsQueryParams): Observable<SellerAnalyticsResponse> {
    let httpParams = new HttpParams();
    if (params.preset) httpParams = httpParams.set('preset', params.preset);
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);
    if (params.category) httpParams = httpParams.set('category', params.category);
    if (params.listingId) httpParams = httpParams.set('listingId', params.listingId);
    return this.http.get<SellerAnalyticsResponse>(`${this.apiUrl}/seller/analytics`, { params: httpParams });
  }

  getBuyerAnalytics(params: BuyerAnalyticsQueryParams): Observable<BuyerAnalyticsResponse> {
    let httpParams = new HttpParams();
    if (params.preset) httpParams = httpParams.set('preset', params.preset);
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);
    if (params.category) httpParams = httpParams.set('category', params.category);
    if (params.interaction) httpParams = httpParams.set('interaction', params.interaction);
    return this.http.get<BuyerAnalyticsResponse>(`${this.apiUrl}/bidder/analytics`, { params: httpParams });
  }

  /** Listings where the current user has placed at least one bid (bidder view) */
  getBidderAuctions(): Observable<ListingsResponse> {
    return this.http.get<ListingsResponse>(`${this.apiUrl}/bidder/my-auctions`);
  }

  /** Listings with all bets (bids + offers) per listing, for My Bets tab */
  getBidderBets(): Observable<{ listings: (Listing & { type?: string; bets?: Array<{ _id: string; amount: number; createdAt: string; type: string; status: string }>; notifyWhenOutbid?: boolean; isWinner?: boolean })[]; total: number }> {
    return this.http.get<any>(`${this.apiUrl}/bidder/my-bets`);
  }

  /** Seller chooses a winner for an ended auction (requires winnerBidId) */
  chooseWinner(listingId: string, winnerBidId: string): Observable<{ listing: Listing; message: string }> {
    return this.http.post<{ listing: Listing; message: string }>(
      `${this.apiUrl}/${listingId}/choose-winner`,
      { winnerBidId }
    );
  }

  /** Seller reopens an ended auction with no bids (extends by 7 days) */
  reopen(listingId: string): Observable<{ listing: Listing; message: string }> {
    return this.http.post<{ listing: Listing; message: string }>(
      `${this.apiUrl}/${listingId}/reopen`,
      {}
    );
  }

  /** Seller edits a listing (state-based field locks enforced by backend) */
  updateListing(listingId: string, data: Partial<Listing>): Observable<{ listing: Listing; message: string; contentWarning?: { severity: string; message: string } }> {
    return this.http.patch<{ listing: Listing; message: string; contentWarning?: { severity: string; message: string } }>(
      `${this.apiUrl}/${listingId}`,
      data
    );
  }

  /** Relist an unsold ended listing (creates a new listing). Seller may override price/duration. */
  relistListing(
    listingId: string,
    body: { startingPrice?: number; durationSlot?: string; autoRelist?: boolean }
  ): Observable<{ message: string; listing: Listing }> {
    return this.http.post<{ message: string; listing: Listing }>(
      `${this.apiUrl}/${listingId}/relist`,
      body
    );
  }
}

