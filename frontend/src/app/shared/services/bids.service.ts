import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface Bid {
  _id: string;
  listing: string;
  bidder?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    emailVerified?: boolean;
    hasDeposit?: boolean;
  } | null;
  bidderEmail?: string | null;
  amount: number;
  bidType: 'manual' | 'proxy' | 'auto';
  maxBid?: number;
  notes?: string;
  bidderName?: string;
  bidderInitials?: string;
  bidderFirstName?: string | null;
  bidderLastName?: string | null;
  isAuthenticated?: boolean;
  bidderVerified?: boolean;
  bidderHasDeposit?: boolean;
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
  /** Whether to receive email when outbid on this listing (default true) */
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

