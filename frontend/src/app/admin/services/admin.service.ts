import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../shared/config/api.config';
import { Listing } from '../../shared/services/listings.service';
import { Transaction } from '../../shared/services/transactions.service';

export interface AdminListingsByAuctionSegment {
  bestOffer: number;
  highestBid: number;
  highestBidPrivateRoom: number;
}

export interface AdminStatistics {
  totalUsers: number;
  /** Published listings only (active, ended, cancelled) */
  totalAuctions: number;
  activeAuctions: number;
  listingsByStatus: Record<string, number>;
  /** Counts by auction format (all statuses; should sum to totalListingsAllStatuses) */
  listingsByAuctionSegment?: AdminListingsByAuctionSegment;
  totalListingsAllStatuses: number;
  openDisputes: number;
  totalTransactions: number;
}

export interface AdminAuctionsResponse {
  auctions: Listing[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface AdminAuctionsQueryParams {
  page?: number;
  limit?: number;
  category?: string;
  status?: string;
}

export interface AdminCustomer {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  accountStatus: 'active' | 'suspended' | 'closed';
  emailVerified: boolean;
  reputationScore: number;
  sellerClassification: 'private' | 'professional';
  createdAt: string;
  lastLogin: string | null;
}

export interface AdminCustomersResponse {
  customers: AdminCustomer[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface AdminCustomersQueryParams {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
}

export interface AdminTransactionsResponse {
  transactions: Transaction[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface AdminTransactionsQueryParams {
  page?: number;
  limit?: number;
  status?: string;
}

export interface AdminReport {
  _id: string;
  reportType: 'listing' | 'user';
  targetId: string;
  reportedBy: { _id: string; firstName: string; lastName: string; email: string };
  reason: 'fraud_scam' | 'offensive_content' | 'prohibited_item' | 'spam' | 'off_platform_transaction' | 'other';
  description: string | null;
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  adminNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminReportsResponse {
  reports: AdminReport[];
  total: number;
}

export interface AdminReportsQueryParams {
  page?: number;
  limit?: number;
  status?: string;
  reportType?: string;
}

export type AdminSnapshotComparisonMode =
  | 'today_vs_yesterday'
  | 'week_vs_week'
  | 'month_vs_month'
  | 'year_vs_year';

export interface AdminSnapshotSide {
  label: string;
  from: string;
  to: string;
  activeAccounts: number;
  newRegistrations: number;
  bids: number;
  paidTransactions: number;
  transactionAmountTotal: number;
  bidRoomFeesTotal: number;
}

export interface AdminPlatformSnapshotComparison {
  comparison: AdminSnapshotComparisonMode;
  current: AdminSnapshotSide;
  previous: AdminSnapshotSide;
  currency: string;
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

  getPlatformSnapshotComparison(mode: AdminSnapshotComparisonMode): Observable<AdminPlatformSnapshotComparison> {
    const params = new HttpParams().set('comparison', mode);
    return this.http.get<AdminPlatformSnapshotComparison>(
      `${this.apiUrl}/platform-snapshot-comparison`,
      { params }
    );
  }

  getAuctions(params?: AdminAuctionsQueryParams): Observable<AdminAuctionsResponse> {
    let httpParams = new HttpParams();
    if (params?.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params?.category && params.category !== 'all') {
      httpParams = httpParams.set('category', params.category);
    }
    if (params?.status && params.status !== 'all') {
      httpParams = httpParams.set('status', params.status);
    }
    return this.http.get<AdminAuctionsResponse>(`${this.apiUrl}/auctions`, { params: httpParams });
  }

  getAuctionById(auctionId: string): Observable<Listing> {
    return this.http.get<Listing>(`${this.apiUrl}/auctions/${auctionId}`);
  }

  createPrivateRoom(auctionId: string, platinumBidderIds: string[]): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/auctions/${auctionId}/private-room`, {
      platinumBidderIds
    });
  }

  closePrivateRoomAndEndAuction(
    auctionId: string
  ): Observable<{ success: boolean; listing: unknown }> {
    return this.http.post<{ success: boolean; listing: unknown }>(
      `${this.apiUrl}/auctions/${auctionId}/close-private-room`,
      {}
    );
  }

  getCustomers(params?: AdminCustomersQueryParams): Observable<AdminCustomersResponse> {
    let httpParams = new HttpParams();
    if (params?.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params?.q) httpParams = httpParams.set('q', params.q);
    if (params?.status && params.status !== 'all') httpParams = httpParams.set('status', params.status);
    return this.http.get<AdminCustomersResponse>(`${this.apiUrl}/customers`, { params: httpParams });
  }

  getTransactions(params?: AdminTransactionsQueryParams): Observable<AdminTransactionsResponse> {
    let httpParams = new HttpParams();
    if (params?.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params?.status && params.status !== 'all') httpParams = httpParams.set('status', params.status);
    return this.http.get<AdminTransactionsResponse>(`${this.apiUrl}/transactions`, { params: httpParams });
  }

  getDisputes(): Observable<{
    disputes: (Transaction & { disputeAgeHours?: number; disputeAgeDays?: number })[];
  }> {
    return this.http.get<{
      disputes: (Transaction & { disputeAgeHours?: number; disputeAgeDays?: number })[];
    }>(`${this.apiUrl}/disputes`);
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
      accountOutcome?:
        | 'reactivate_both'
        | 'reactivate_buyer_close_seller'
        | 'reactivate_seller_close_buyer'
        | 'close_both';
    }
  ): Observable<{ success: boolean; transaction: Transaction }> {
    return this.http.post<{ success: boolean; transaction: Transaction }>(
      `${this.apiUrl}/disputes/${transactionId}/ruling`,
      payload
    );
  }

  getReports(params?: AdminReportsQueryParams): Observable<AdminReportsResponse> {
    let httpParams = new HttpParams();
    if (params?.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params?.status && params.status !== 'all') httpParams = httpParams.set('status', params.status);
    if (params?.reportType && params.reportType !== 'all') httpParams = httpParams.set('reportType', params.reportType);
    return this.http.get<AdminReportsResponse>(`${this.apiUrl}/reports`, { params: httpParams });
  }

  updateReport(id: string, payload: { status: string; adminNotes?: string }): Observable<{ report: AdminReport }> {
    return this.http.patch<{ report: AdminReport }>(`${this.apiUrl}/reports/${id}`, payload);
  }

  deleteListing(id: string): Observable<{ ok: boolean; deletedId: string }> {
    return this.http.delete<{ ok: boolean; deletedId: string }>(`${this.apiUrl}/auctions/${id}`);
  }
}
