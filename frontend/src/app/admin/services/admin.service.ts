import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../shared/config/api.config';
import { Listing } from '../../shared/services/listings.service';
import { Transaction } from '../../shared/services/transactions.service';

export interface AdminStatistics {
  totalUsers: number;
  totalAuctions: number;
  activeAuctions: number;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private http = inject(HttpClient);

  private get apiUrl(): string {
    return `${API_CONFIG.getApiUrl()}/admin`;
  }

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

  closePrivateRoomAndEndAuction(auctionId: string): Observable<{ success: boolean; listing: unknown }> {
    return this.http.post<{ success: boolean; listing: unknown }>(`${this.apiUrl}/auctions/${auctionId}/close-private-room`, {});
  }

  getDisputes(): Observable<{ disputes: (Transaction & { disputeAgeHours?: number; disputeAgeDays?: number })[] }> {
    return this.http.get<{ disputes: (Transaction & { disputeAgeHours?: number; disputeAgeDays?: number })[] }>(`${this.apiUrl}/disputes`);
  }

  getDispute(transactionId: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${this.apiUrl}/disputes/${transactionId}`);
  }

  issueDisputeRuling(
    transactionId: string,
    payload: {
      verdict: 'buyer_refund' | 'seller_payout' | 'partial_refund';
      refundAmount?: number;
      adminNotes?: string;
      accountOutcome?: 'reactivate_both' | 'reactivate_buyer_close_seller' | 'reactivate_seller_close_buyer' | 'close_both';
    }
  ): Observable<{ success: boolean; transaction: Transaction }> {
    return this.http.post<{ success: boolean; transaction: Transaction }>(`${this.apiUrl}/disputes/${transactionId}/ruling`, payload);
  }
}

