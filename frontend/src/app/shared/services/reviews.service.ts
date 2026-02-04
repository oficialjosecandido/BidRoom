import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface PendingReview {
  listingId: string;
  listingTitle: string;
  listingSlug: string;
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
  rating: number;
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

  createReview(body: CreateReviewRequest): Observable<{ _id: string; createdAt: string }> {
    return this.http.post<{ _id: string; createdAt: string }>(this.apiUrl, body);
  }
}
