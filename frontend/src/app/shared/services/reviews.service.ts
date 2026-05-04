import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface PendingReview {
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  transactionId?: string;
  completedAt?: string;
  reviewDeadline?: string;
  otherPartyId: string;
  otherPartyName: string;
  myRole: 'seller' | 'buyer';
  theirRole: 'seller' | 'buyer';
  roleForReview: 'as_buyer' | 'as_seller';
}

export interface PendingReviewsResponse {
  pending: PendingReview[];
}

export interface ReviewScores {
  buyerScore: number | null;
  buyerReviewCount: number;
  sellerScore: number | null;
  sellerReviewCount: number;
}

export type ReviewTag =
  | 'fast_payment' | 'fast_shipping' | 'item_as_described' | 'great_packaging'
  | 'good_communication' | 'smooth_transaction' | 'trustworthy'
  | 'slow_payment' | 'slow_shipping' | 'not_as_described' | 'poor_communication';

export interface CreateReviewRequest {
  listingId: string;
  toUserId: string;
  role: 'as_buyer' | 'as_seller';
  score: number; // 1-5
  description?: string;
  tags?: ReviewTag[];
  /** @deprecated Use score */
  rating?: number;
  /** @deprecated Use description */
  comment?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReviewsService {
  private http = inject(HttpClient);

  private apiUrl = `${API_CONFIG.getApiUrl()}/reviews`;

  getPending(): Observable<PendingReviewsResponse> {
    return this.http.get<PendingReviewsResponse>(`${this.apiUrl}/pending`);
  }

  getScoresForUser(userId: string): Observable<ReviewScores> {
    return this.http.get<ReviewScores>(`${this.apiUrl}/scores/${userId}`);
  }

  createReview(body: CreateReviewRequest): Observable<{ _id: string; score: number; createdAt: string }> {
    const payload: Record<string, unknown> = {
      listingId: body.listingId,
      toUserId: body.toUserId,
      role: body.role,
      score: body.score,
      description: body.description?.trim() || undefined
    };
    if (body.tags && body.tags.length > 0) payload['tags'] = body.tags;
    return this.http.post<{ _id: string; score: number; createdAt: string }>(this.apiUrl, payload);
  }

  flagReview(reviewId: string, reason: string, details?: string): Observable<{ success: boolean; flagId: string }> {
    return this.http.post<{ success: boolean; flagId: string }>(`${this.apiUrl}/${reviewId}/flag`, {
      reason,
      details
    });
  }

  appealReview(reviewId: string, reason: string, details?: string): Observable<{ success: boolean; appealId: string }> {
    return this.http.post<{ success: boolean; appealId: string }>(`${this.apiUrl}/${reviewId}/appeals`, {
      reason,
      details
    });
  }
}
