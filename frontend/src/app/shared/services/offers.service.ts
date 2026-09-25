import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface Offer {
  _id: string;
  listing: string;
  offerer: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  amount: number;
  message?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  respondedAt?: string;
  sellerResponse?: string;
  offererName?: string;
  offererInitials?: string;
  /** Whether the bidder has verified their email (only for registered users). */
  offererVerified?: boolean;
  /** Membership tier from balance: Bronze, Silver, Gold, or Platinum (only for registered users with customer record). */
  offererTier?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OffersResponse {
  offers: Offer[];
  /** Total across all pages, not the length of `offers` — the API paginates. */
  total: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
}

export interface CreateOfferRequest {
  listingId: string;
  amount: number;
  message?: string;
  /** Required when not authenticated (guest offer) */
  email?: string;
}

@Injectable({
  providedIn: 'root'
})
export class OffersService {
  private http = inject(HttpClient);

  private apiUrl = `${API_CONFIG.getApiUrl()}/offers`;

  /** One page of a listing's offers. The API caps the page size regardless of `limit`. */
  getOffersByListing(listingId: string, limit?: number, offset?: number): Observable<OffersResponse> {
    let params = new HttpParams();
    if (limit != null) params = params.set('limit', limit);
    if (offset != null) params = params.set('offset', offset);
    return this.http.get<OffersResponse>(`${this.apiUrl}/listing/${listingId}`, { params });
  }

  createOffer(offerData: CreateOfferRequest): Observable<Offer> {
    return this.http.post<Offer>(this.apiUrl, offerData);
  }

  acceptOffer(offerId: string, message?: string): Observable<Offer> {
    return this.http.patch<Offer>(`${this.apiUrl}/${offerId}/accept`, { message });
  }

  rejectOffer(offerId: string, message?: string): Observable<Offer> {
    return this.http.patch<Offer>(`${this.apiUrl}/${offerId}/reject`, { message });
  }
}

