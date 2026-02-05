import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface Listing {
  _id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  subCategory?: string;
  images: string[];
  startingPrice: number;
  currentPrice: number;
  reservePrice?: number;
  buyNowPrice?: number;
  bidIncrement: number;
  bidCount: number;
  startDate: string;
  endDate: string;
  seller: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  status: 'draft' | 'active' | 'ended' | 'cancelled';
  isFeatured: boolean;
  isVerified: boolean;
  verificationDetails?: string;
  listingType: 'Promoted' | 'Verified' | 'Standard';
  condition: string;
  location?: string;
  shippingCost: number;
  // New auction mechanics
  auctionFormat: 'highest-bid' | 'best-offer';
  durationSlot: '5 minutes' | '2 hours' | '24 hours' | '3 days' | '7 days';
  allowPrivateRoom: boolean;
  commissionRate: number;
  privateRoomStatus?: 'not-triggered' | 'eligible' | 'active' | 'ended';
  privateRoomEndDate?: string;
  privateRoomLastBidTime?: string;
  platinumBidders?: string[] | Array<{ _id: string; firstName: string; lastName: string; email: string }>;
  platinumBidderInvitedAt?: string;
  platinumBidderAcceptanceDeadline?: string;
  platinumBidderStatus?: Array<{
    bidder: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
    status: 'pending' | 'accepted' | 'declined';
    invitedAt: string;
    acceptedAt?: string | null;
  }>;
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
  /** Seller's average rating as seller (from reviews) */
  sellerScore?: number | null;
  /** Number of reviews the seller has received as seller */
  sellerReviewCount?: number;
  /** Set on bidder/my-auctions: user's highest bid on this listing */
  myHighestBid?: number | null;
  /** Set on bidder/my-auctions: when user last bid */
  myLastBidAt?: string | null;
  /** Set on bidder/my-auctions: user's preference to receive outbid emails */
  notifyWhenOutbid?: boolean;
}

export interface ListingsResponse {
  listings: Listing[];
  total: number;
  limit: number;
  skip: number;
}

export interface ListingsQueryParams {
  category?: string;
  sort?: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids';
  minPrice?: number;
  maxPrice?: number;
  minBids?: number;
  listingType?: 'Promoted' | 'Verified' | 'Standard';
  status?: string;
  search?: string;
  limit?: number;
  skip?: number;
}

export interface StatsOverview {
  totalBidders: number;
  activeListings: number;
  totalValueTraded: number;
}

@Injectable({
  providedIn: 'root'
})
export class ListingsService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/listings`;

  constructor(private http: HttpClient) {}

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

  getListing(id: string): Observable<Listing> {
    return this.http.get<Listing>(`${this.apiUrl}/${id}`);
  }

  getStats(): Observable<StatsOverview> {
    return this.http.get<StatsOverview>(`${this.apiUrl}/stats/overview`);
  }

  createListing(listingData: Partial<Listing>): Observable<Listing> {
    return this.http.post<Listing>(this.apiUrl, listingData);
  }

  buyNow(listingId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${listingId}/buy-now`, {});
  }

  getMyListings(): Observable<ListingsResponse> {
    return this.http.get<ListingsResponse>(`${this.apiUrl}/seller/my-listings`);
  }

  /** Listings where the current user has placed at least one bid (bidder view) */
  getBidderAuctions(): Observable<ListingsResponse> {
    return this.http.get<ListingsResponse>(`${this.apiUrl}/bidder/my-auctions`);
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
}

