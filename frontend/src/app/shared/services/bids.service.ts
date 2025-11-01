import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface Bid {
  _id: string;
  listing: string;
  bidder: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  amount: number;
  bidType: 'manual' | 'proxy' | 'auto';
  maxBid?: number;
  status: 'active' | 'outbid' | 'winning' | 'cancelled';
  isWinning: boolean;
  notes?: string;
  bidderName?: string;
  bidderInitials?: string;
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
}

@Injectable({
  providedIn: 'root'
})
export class BidsService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/bids`;

  constructor(private http: HttpClient) {}

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
}

