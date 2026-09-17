import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
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

/** Outcome of approving or rejecting a listing held for manual review. */
export interface AdminReviewResponse {
  success: boolean;
  listing: { _id: string; slug: string; status: string; endDate?: string };
}

export interface AdminAuctionsQueryParams {
  page?: number;
  limit?: number;
  category?: string;
  status?: string;
  q?: string;
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
  contentViolationCount?: number;
  contentRestrictedUntil?: string | null;
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

/**
 * A vehicle-compliance or AML flag raised for review.
 *
 * Nothing was blocked when these were raised — each one is a pattern that needs
 * a person to decide about, not an enforcement action already taken.
 */
export interface AdminComplianceFlag {
  _id: string;
  type: 'undeclared_professional' | 'aml_repeat_winner' | 'aml_new_seller_high_value';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    sellerClassification?: 'private' | 'professional';
    kycStatus?: string;
    createdAt?: string;
  } | null;
  listingId: {
    _id: string;
    title: string;
    slug: string;
    category: string;
    startingPrice?: number;
    buyNowPrice?: number;
  } | null;
  details: Record<string, unknown>;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedByEmail: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface AdminComplianceFlagsResponse {
  flags: AdminComplianceFlag[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export type AdminGiveawayPhase = 'pending' | 'open' | 'closed' | 'drawn' | 'cancelled';

interface AdminGiveawayPerson {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** A giveaway as Nexus lists it — the listing plus where it is in its life. */
export interface AdminGiveaway {
  _id: string;
  title: string;
  titlePt?: string | null;
  slug: string;
  images: string[];
  status: string;
  startDate?: string;
  endDate: string;
  createdAt: string;
  category?: string;
  condition?: string;
  phase: AdminGiveawayPhase;
  totalEntries: number;
  seller?: AdminGiveawayPerson;
  giveaway?: {
    entryCount: number;
    drawnAt: string | null;
    winnerEntry: number | null;
    winner: AdminGiveawayPerson | null;
    drawnByEmail?: string | null;
    /** When the winner email went out; null if it has not (Nexus offers to send it). */
    winnerEmailedAt?: string | null;
    drawVideo?: AdminGiveawayDrawVideo | null;
  };
}

export interface AdminGiveawayDrawVideo {
  url: string | null;
  type: 'upload' | 'youtube' | 'instagram' | null;
  publishedAt: string | null;
}

export interface AdminGiveawaysResponse {
  giveaways: AdminGiveaway[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface AdminGiveawayEntry {
  _id: string;
  entryNumber: number;
  participant: AdminGiveawayPerson | null;
  createdAt: string;
}

export interface AdminGiveawayEntriesResponse {
  giveaway: AdminGiveaway;
  entries: AdminGiveawayEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface AdminGiveawayDrawResponse {
  success: boolean;
  winnerEntry: number;
  totalEntries: number;
  drawnAt: string;
  winner: AdminGiveawayPerson & { publicName: string };
  /** 'pending' when the mail server was still working when the API answered. */
  winnerEmail: 'sent' | 'failed' | 'pending';
  winnerEmailedAt: string | null;
}

export interface AdminGiveawayDrawVideoResponse {
  success: boolean;
  drawVideo: AdminGiveawayDrawVideo;
}

/**
 * What Nexus sends to create a giveaway. It goes through the ordinary listing
 * route, which is where the admin-only check and the free-entry rules live.
 */
export interface AdminCreateGiveawayPayload {
  saleFormat: 'giveaway';
  title: string;
  description: string;
  category: string;
  subCategory: string;
  condition: string;
  duration: string;
  shippingOption: 'free' | 'local-pickup';
  locationCity: string;
  locationCountry: string;
  location: string;
  images: string[];
}

export interface AdminCreateAuctionPayload {
  sellerEmail?: string;
  sellerId?: string;
  title: string;
  titleEn?: string;
  titleEs?: string;
  titleFr?: string;
  description: string;
  descriptionEn?: string;
  descriptionEs?: string;
  descriptionFr?: string;
  category?: string;
  subCategory?: string;
  condition?: string;
  /** auction (via listingFormat) or giveaway */
  saleFormat?: 'auction' | 'giveaway';
  listingFormat?: 'highest-bid' | 'best-offer';
  startingPrice?: number;
  duration?: string;
  shippingOption?: string;
  shippingCost?: number;
  returnPolicy?: string;
  locationCity?: string;
  locationCountry?: string;
  allowPrivateRoom?: boolean;
  images?: string[];
}

export interface AdminCreateAuctionResponse {
  ok: boolean;
  sellerCreated?: boolean;
  listing: {
    _id: string;
    title: string;
    slug: string;
    status: string;
    saleFormat?: string;
    endDate: string;
    seller: { _id: string; email: string; firstName: string; lastName: string };
  };
}

export interface AdminCsvImportResultRow {
  row: number;
  ok: boolean;
  title?: string | null;
  listingId?: string;
  slug?: string;
  sellerEmail?: string;
  error?: string;
}

export interface AdminCsvImportResponse {
  ok: boolean;
  created: number;
  failed: number;
  total: number;
  results: AdminCsvImportResultRow[];
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
    if (params?.q?.trim()) {
      httpParams = httpParams.set('q', params.q.trim());
    }
    return this.http.get<AdminAuctionsResponse>(`${this.apiUrl}/auctions`, { params: httpParams });
  }

  getAuctionById(auctionId: string): Observable<Listing> {
    return this.http.get<Listing>(`${this.apiUrl}/auctions/${auctionId}`);
  }

  /**
   * Publish a listing that is waiting for manual review. The backend restarts
   * the auction clock at this moment, so the returned endDate is the real one.
   */
  approveListing(auctionId: string): Observable<AdminReviewResponse> {
    return this.http.post<AdminReviewResponse>(`${this.apiUrl}/auctions/${auctionId}/approve`, {});
  }

  /** Reject a listing awaiting review. The reason is sent to the seller. */
  rejectListing(auctionId: string, reason: string): Observable<AdminReviewResponse> {
    return this.http.post<AdminReviewResponse>(`${this.apiUrl}/auctions/${auctionId}/reject`, { reason });
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

  unlockContentRestriction(customerId: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/customers/${customerId}/unlock-content-restriction`,
      {}
    );
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

  getComplianceFlags(params?: { resolved?: boolean; type?: string; limit?: number }): Observable<AdminComplianceFlagsResponse> {
    let httpParams = new HttpParams().set('resolved', String(params?.resolved === true));
    if (params?.type && params.type !== 'all') httpParams = httpParams.set('type', params.type);
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    return this.http.get<AdminComplianceFlagsResponse>(`${this.apiUrl}/compliance-flags`, { params: httpParams });
  }

  /** The note is required by the API — a closed flag with no reasoning is not evidence of review. */
  resolveComplianceFlag(id: string, resolutionNote: string): Observable<{ flag: AdminComplianceFlag }> {
    return this.http.patch<{ flag: AdminComplianceFlag }>(`${this.apiUrl}/compliance-flags/${id}`, { resolutionNote });
  }

  getGiveaways(params?: { phase?: string; page?: number; limit?: number }): Observable<AdminGiveawaysResponse> {
    let httpParams = new HttpParams();
    if (params?.phase && params.phase !== 'all') httpParams = httpParams.set('phase', params.phase);
    if (params?.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    return this.http.get<AdminGiveawaysResponse>(`${this.apiUrl}/giveaways`, { params: httpParams });
  }

  getGiveawayEntries(id: string, params?: { page?: number; limit?: number }): Observable<AdminGiveawayEntriesResponse> {
    let httpParams = new HttpParams();
    if (params?.page != null) httpParams = httpParams.set('page', String(params.page));
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    return this.http.get<AdminGiveawayEntriesResponse>(`${this.apiUrl}/giveaways/${id}/entries`, { params: httpParams });
  }

  /** Draws once. A second call is refused by the API with giveaway_already_drawn. */
  drawGiveaway(id: string): Observable<AdminGiveawayDrawResponse> {
    return this.http.post<AdminGiveawayDrawResponse>(`${this.apiUrl}/giveaways/${id}/draw`, {});
  }

  /** Resend the winner email. Fails with giveaway_email_failed (502) if the mail server refuses it. */
  emailGiveawayWinner(id: string): Observable<{ success: boolean; winnerEmailedAt: string }> {
    return this.http.post<{ success: boolean; winnerEmailedAt: string }>(`${this.apiUrl}/giveaways/${id}/email-winner`, {});
  }

  /** Publish a YouTube or Instagram link as the draw video. The API checks and canonicalises it. */
  publishGiveawayDrawVideoLink(id: string, url: string): Observable<AdminGiveawayDrawVideoResponse> {
    return this.http.post<AdminGiveawayDrawVideoResponse>(`${this.apiUrl}/giveaways/${id}/draw-video`, { url });
  }

  /** Upload a recording (MP4/MOV/WebM, ≤200 MB) and publish it. Emits progress events. */
  uploadGiveawayDrawVideo(id: string, file: File): Observable<HttpEvent<AdminGiveawayDrawVideoResponse>> {
    const formData = new FormData();
    formData.append('video', file);
    return this.http.post<AdminGiveawayDrawVideoResponse>(`${this.apiUrl}/giveaways/${id}/draw-video/upload`, formData, {
      reportProgress: true,
      observe: 'events'
    });
  }

  removeGiveawayDrawVideo(id: string): Observable<{ success: boolean; removed: boolean }> {
    return this.http.delete<{ success: boolean; removed: boolean }>(`${this.apiUrl}/giveaways/${id}/draw-video`);
  }

  uploadImages(files: File[]): Observable<{ urls: string[] }> {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));
    return this.http.post<{ urls: string[] }>(`${API_CONFIG.getApiUrl()}/uploads`, formData);
  }

  /** Created pending review like every listing — it goes live when approved. */
  createGiveaway(payload: AdminCreateGiveawayPayload): Observable<Listing> {
    return this.http.post<Listing>(`${API_CONFIG.getApiUrl()}/listings`, payload);
  }

  deleteListing(id: string): Observable<{ ok: boolean; deletedId: string }> {
    return this.http.delete<{ ok: boolean; deletedId: string }>(`${this.apiUrl}/auctions/${id}`);
  }

  createAuction(payload: AdminCreateAuctionPayload): Observable<AdminCreateAuctionResponse> {
    return this.http.post<AdminCreateAuctionResponse>(`${this.apiUrl}/auctions`, payload);
  }

  importAuctionsCsv(file: File): Observable<AdminCsvImportResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<AdminCsvImportResponse>(`${this.apiUrl}/auctions/import`, formData);
  }

  createReport(payload: {
    reportType?: 'listing' | 'user';
    targetId: string;
    reason: string;
    description?: string;
  }): Observable<{ ok: boolean; message: string; reportId: string }> {
    return this.http.post<{ ok: boolean; message: string; reportId: string }>(
      `${this.apiUrl}/reports`,
      payload
    );
  }

  updateListingCategory(
    id: string,
    payload: { category: string; subCategory: string }
  ): Observable<{ ok: boolean; category: string; subCategory: string }> {
    return this.http.patch<{ ok: boolean; category: string; subCategory: string }>(
      `${this.apiUrl}/auctions/${id}/category`,
      payload
    );
  }

  updateListingEndDate(
    id: string,
    endDate: string
  ): Observable<{ ok: boolean; endDate: string }> {
    return this.http.patch<{ ok: boolean; endDate: string }>(
      `${this.apiUrl}/auctions/${id}/end-date`,
      { endDate }
    );
  }

  /** Title and description per language; an empty language falls back to the main text. */
  updateListingText(id: string, text: AdminListingText): Observable<{ ok: boolean; listing: AdminListingText & { title: string; description: string } }> {
    return this.http.patch<{ ok: boolean; listing: AdminListingText & { title: string; description: string } }>(
      `${this.apiUrl}/auctions/${id}/text`,
      text
    );
  }

  /** Uploads photos (up to 10 per call, 10 MB each) and appends them to the listing. */
  addListingImages(id: string, files: File[]): Observable<{ ok: boolean; images: string[] }> {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));
    return this.http.post<{ ok: boolean; images: string[] }>(`${this.apiUrl}/auctions/${id}/images`, formData);
  }

  /**
   * Keeps these photos in this order (the first is the cover) and removes the rest.
   * `expected` is the list on screen; if the listing's photos changed meanwhile
   * the API answers 409 images_changed and nothing is written.
   */
  setListingImages(id: string, images: string[], expected: string[]): Observable<{ ok: boolean; images: string[] }> {
    return this.http.put<{ ok: boolean; images: string[] }>(`${this.apiUrl}/auctions/${id}/images`, { images, expected });
  }

  getListingSocial(id: string): Observable<AdminListingSocial> {
    return this.http.get<AdminListingSocial>(`${this.apiUrl}/auctions/${id}/social`);
  }

  /**
   * Starts publishing in the background (202). Refused with 409 already_posted
   * when the listing is already on that platform, unless `repost` is true.
   */
  publishListingToSocial(id: string, platform: AdminSocialPlatform, repost = false): Observable<{ ok: boolean; status: string }> {
    return this.http.post<{ ok: boolean; status: string }>(
      `${this.apiUrl}/auctions/${id}/social/${platform}`,
      { repost }
    );
  }
}

export interface AdminListingText {
  titlePt: string | null;
  titleEn: string | null;
  titleFr: string | null;
  titleEs: string | null;
  descriptionPt: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  descriptionEs: string | null;
}

export type AdminSocialPlatform = 'facebook' | 'instagram';

export interface AdminSocialPostState {
  status: 'publishing' | 'published' | 'failed';
  startedAt: string | null;
  requestedBy: string | null;
  postedAt: string | null;
  error: string | null;
  postId?: string | null;
  mediaId?: string | null;
  permalink?: string | null;
  imagesSent?: number | null;
  imageCount?: number | null;
}

export interface AdminListingSocial {
  caption: string;
  link: string;
  imageCount: number;
  instagramMaxImages: number;
  autopost: { enabled: boolean; reason: string | null };
  platforms: Record<AdminSocialPlatform, {
    available: boolean;
    reason: string | null;
    state: AdminSocialPostState | null;
  }>;
}
