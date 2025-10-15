import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';

export interface Bid {
  _id: string;
  auctionId: string;
  bidderId: string;
  amount: number;
  isAutoBid: boolean;
  maxAutoBidAmount?: number;
  isPrivateRoomBid: boolean;
  bidTime: Date;
}

export interface PlaceBidRequest {
  auctionId: string;
  amount: number;
  isAutoBid?: boolean;
  maxAutoBidAmount?: number;
}

@Injectable({
  providedIn: 'root',
})
export class BidService {
  private apiUrl = `${environment.apiUrl}/bids`;

  constructor(private http: HttpClient) {}

  placeBid(bidData: PlaceBidRequest): Observable<Bid> {
    return this.http.post<Bid>(this.apiUrl, bidData);
  }

  getAuctionBids(auctionId: string, page: number = 1, limit: number = 50): Observable<{ bids: Bid[]; total: number }> {
    return this.http.get<{ bids: Bid[]; total: number }>(`${this.apiUrl}/auction/${auctionId}`, {
      params: { page: page.toString(), limit: limit.toString() },
    });
  }

  getUserBids(page: number = 1, limit: number = 50): Observable<{ bids: Bid[]; total: number }> {
    return this.http.get<{ bids: Bid[]; total: number }>(`${this.apiUrl}/user/me`, {
      params: { page: page.toString(), limit: limit.toString() },
    });
  }
}

