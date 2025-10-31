import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Listing {
  _id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  images: string[];
  startingPrice: number;
  currentPrice: number;
  reservePrice?: number;
  buyNowPrice?: number;
  bidIncrement: number;
  bidCount: number;
  startDate: string;
  endDate: string;
  seller: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  status: 'draft' | 'active' | 'ended' | 'cancelled';
  isFeatured: boolean;
  isVerified: boolean;
  verificationDetails?: string;
  listingType: 'Promoted' | 'Verified' | 'Standard';
  condition: string;
  location?: string;
  shippingCost: number;
  // New auction mechanics
  auctionFormat: 'highest-bid' | 'best-offer';
  durationSlot: '2 hours' | '24 hours' | '3 days' | '7 days';
  allowPrivateRoom: boolean;
  commissionRate: number;
  privateRoomStatus?: 'not-triggered' | 'eligible' | 'active' | 'ended';
  privateRoomEndDate?: string;
  privateRoomLastBidTime?: string;
  minimumOfferPrice?: number; // For Best Offer format
  renewalRequired?: boolean;
  uniqueBidders?: string[];
  timeRemaining?: {
    ended: boolean;
    days: number;
    hours: number;
    minutes: number;
    totalMs: number;
  };
  endingSoon?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListingsResponse {
  listings: Listing[];
  total: number;
  limit: number;
  skip: number;
}

export interface ListingsQueryParams {
  category?: string;
  sort?: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids';
  minPrice?: number;
  maxPrice?: number;
  minBids?: number;
  listingType?: 'Promoted' | 'Verified' | 'Standard';
  status?: string;
  search?: string;
  limit?: number;
  skip?: number;
}

export interface StatsOverview {
  totalBidders: number;
  activeListings: number;
  totalValueTraded: number;
}

@Injectable({
  providedIn: 'root'
})
export class ListingsService {
  private apiUrl = 'http://localhost:3000/api/listings';

  constructor(private http: HttpClient) {}

  getListings(params?: ListingsQueryParams): Observable<ListingsResponse> {
    let httpParams = new HttpParams();
    
    if (params) {
      Object.keys(params).forEach(key => {
        const value = params[key as keyof ListingsQueryParams];
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }

    return this.http.get<ListingsResponse>(this.apiUrl, { params: httpParams });
  }

  getListingById(id: string): Observable<Listing> {
    return this.http.get<Listing>(`${this.apiUrl}/${id}`);
  }

  getListingBySlug(slug: string): Observable<Listing> {
    return this.http.get<Listing>(`${this.apiUrl}/slug/${slug}`);
  }

  getStats(): Observable<StatsOverview> {
    return this.http.get<StatsOverview>(`${this.apiUrl}/stats/overview`);
  }

  createListing(listingData: Partial<Listing>): Observable<Listing> {
    return this.http.post<Listing>(this.apiUrl, listingData);
  }

  buyNow(listingId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${listingId}/buy-now`, {});
  }
}

