import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface Bid {
  _id: string;
  listing: string;
  /**
   * The API no longer returns the bidder's email, nor maxBid (the proxy
   * ceiling), nor the internal fraud/IP fields — see backend utils/bidFormat.js.
   * Use bidderId for registered bidders and bidderKey, an opaque per-listing
   * pseudonym, to group a guest's bids.
   */
  bidderId?: string | null;
  bidderKey?: string | null;
  amount: number;
  bidType: 'manual' | 'proxy' | 'auto';
  bidderName?: string;
  bidderInitials?: string;
  bidderFirstName?: string | null;
  bidderLastName?: string | null;
  isAuthenticated?: boolean;
  bidderVerified?: boolean;
  buyerTrustTier?: number;
  reputationScore?: number | null;
  /** Bidder's average rating as buyer (from reviews) */
  buyerScore?: number | null;
  /** Number of reviews the bidder has received as buyer */
  buyerReviewCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BidsResponse {
  bids: Bid[];
  total: number;
  /**
   * The viewer's own bidderId, when they are logged in and have bid on this
   * listing. Lets the client highlight its own bids without the API publishing
   * an identifier for anyone else.
   */
  viewerBidderId?: string | null;
}

export interface BidStats {
  totalBids: number;
  uniqueBidders: number;
  highestBid: number;
  averageBid: number;
}

export interface CreateBidRequest {
  listingId: string;
  amount: number;
  maxBid?: number;
  bidType?: 'manual' | 'proxy' | 'auto';
  notes?: string;
  email?: string; // Required for unauthenticated users
  /** Whether to receive email and in-app notifications when outbid (default true) */
  notifyWhenOutbid?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class BidsService {
  private http = inject(HttpClient);

  private apiUrl = `${API_CONFIG.getApiUrl()}/bids`;

  getBidsByListing(listingId: string, sort: 'asc' | 'desc' = 'desc'): Observable<BidsResponse> {
    const params = new HttpParams().set('sort', sort);
    return this.http.get<BidsResponse>(`${this.apiUrl}/listing/${listingId}`, { params });
  }

  getBidStats(listingId: string): Observable<BidStats> {
    return this.http.get<BidStats>(`${this.apiUrl}/listing/${listingId}/stats`);
  }

  createBid(bidData: CreateBidRequest): Observable<Bid> {
    return this.http.post<Bid>(this.apiUrl, bidData);
  }

  /** Update outbid notification preference for a listing (authenticated bidders only) */
  updateBidderPreference(listingId: string, notifyWhenOutbid: boolean): Observable<{ listingId: string; notifyWhenOutbid: boolean; updated: number }> {
    return this.http.patch<{ listingId: string; notifyWhenOutbid: boolean; updated: number }>(
      `${this.apiUrl}/preference`,
      { listingId, notifyWhenOutbid }
    );
  }
}

