import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface PendingReview {
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  transactionId?: string;
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
  score: number;
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
  private apiUrl = `${API_CONFIG.getApiUrl()}/reviews`;

  constructor(private http: HttpClient) {}

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
}
