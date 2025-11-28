import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../shared/config/api.config';
import { Listing } from '../../shared/services/listings.service';

export interface AdminStatistics {
  totalUsers: number;
  totalAuctions: number;
  activeAuctions: number;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private get apiUrl(): string {
    return `${API_CONFIG.getApiUrl()}/admin`;
  }

  constructor(private http: HttpClient) {}

  getStatistics(): Observable<AdminStatistics> {
    return this.http.get<AdminStatistics>(`${this.apiUrl}/statistics`);
  }

  getAuctions(): Observable<Listing[]> {
    return this.http.get<Listing[]>(`${this.apiUrl}/auctions`);
  }

  getAuctionById(auctionId: string): Observable<Listing> {
    return this.http.get<Listing>(`${this.apiUrl}/auctions/${auctionId}`);
  }

  createPrivateRoom(auctionId: string, platinumBidderIds: string[]): Observable<any> {
    return this.http.post(`${this.apiUrl}/auctions/${auctionId}/private-room`, {
      platinumBidderIds
    });
  }

  closePrivateRoomAndEndAuction(auctionId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/auctions/${auctionId}/close-private-room`, {});
  }
}

