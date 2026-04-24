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

export interface CreateReviewRequest {
  listingId: string;
  toUserId: string;
  role: 'as_buyer' | 'as_seller';
  score: number; // 1-5
  description?: string;
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
    const payload = {
      listingId: body.listingId,
      toUserId: body.toUserId,
      role: body.role,
      score: body.score,
      description: body.description?.trim() || undefined
    };
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
