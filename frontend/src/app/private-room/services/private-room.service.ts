import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../shared/config/api.config';

export interface Bidder {
  _id?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  emailVerified?: boolean;
  hasDeposit?: boolean;
  isAuthenticated: boolean;
  bidCount: number;
  highestBid: number;
  firstBidDate: string;
  lastBidDate: string;
}

export interface BiddersResponse {
  listingId: string;
  bidders: Bidder[];
  currentPlatinumBidders: string[];
}

export interface SelectPlatinumBiddersRequest {
  bidderIds: string[];
}

export interface SelectPlatinumBiddersResponse {
  success: boolean;
  message: string;
  platinumBidders: string[];
  listing: {
    id: string;
    platinumBidders: string[];
    platinumBidderInvitedAt: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class PrivateRoomService {
  private get apiUrl(): string {
    return `${API_CONFIG.getApiUrl()}/private-room`;
  }

  constructor(private http: HttpClient) {}

  getBidders(listingId: string): Observable<BiddersResponse> {
    return this.http.get<BiddersResponse>(`${this.apiUrl}/listings/${listingId}/bidders`);
  }

  selectPlatinumBidders(listingId: string, bidderIds: string[]): Observable<SelectPlatinumBiddersResponse> {
    return this.http.post<SelectPlatinumBiddersResponse>(
      `${this.apiUrl}/listings/${listingId}/platinum-bidders`,
      { bidderIds }
    );
  }

  acceptInvitation(token: string, listingId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/invitation/accept`, { token, listingId });
  }

  declineInvitation(token: string, listingId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/invitation/decline`, { token, listingId });
  }

      checkPlatinumBidderStatus(listingId: string): Observable<{ isPlatinumBidder: boolean }> {
        return this.http.get<{ isPlatinumBidder: boolean }>(`${this.apiUrl}/listings/${listingId}/check-platinum`);
      }
}

