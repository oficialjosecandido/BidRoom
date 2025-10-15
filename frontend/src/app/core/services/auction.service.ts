import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';

export interface Auction {
  _id: string;
  sellerId: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  images: Array<{
    url: string;
    alt: string;
    isPrimary: boolean;
  }>;
  format: 'highest_bid' | 'best_offer';
  duration: '2h' | '24h' | '3d' | '7d';
  startingBid: number;
  currentBid: number;
  buyNowPrice?: number;
  reservePrice?: number;
  minBidIncrement: number;
  allowPrivateRoom: boolean;
  status: 'draft' | 'active' | 'ended' | 'sold' | 'cancelled' | 'private_room';
  startTime: Date;
  endTime: Date;
  totalBids: number;
  uniqueBidders: number;
  viewCount: number;
  watcherCount: number;
  isVerified: boolean;
  isPromoted: boolean;
}

export interface AuctionFilters {
  page?: number;
  limit?: number;
  category?: string;
  sortBy?: 'endTime' | 'currentBid' | 'totalBids' | 'createdAt';
  order?: 'asc' | 'desc';
  minPrice?: number;
  maxPrice?: number;
  status?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuctionService {
  private apiUrl = `${environment.apiUrl}/auctions`;

  constructor(private http: HttpClient) {}

  getAuctions(filters?: AuctionFilters): Observable<{ auctions: Auction[]; total: number }> {
    let params = new HttpParams();
    
    if (filters) {
      Object.keys(filters).forEach((key) => {
        const value = (filters as any)[key];
        if (value !== undefined && value !== null) {
          params = params.set(key, value.toString());
        }
      });
    }

    return this.http.get<{ auctions: Auction[]; total: number }>(this.apiUrl, { params });
  }

  getAuctionById(id: string): Observable<Auction> {
    return this.http.get<Auction>(`${this.apiUrl}/${id}`);
  }

  getEndingSoon(limit: number = 10): Observable<Auction[]> {
    return this.http.get<Auction[]>(`${this.apiUrl}/ending-soon`, {
      params: { limit: limit.toString() },
    });
  }

  getPromoted(limit: number = 5): Observable<Auction[]> {
    return this.http.get<Auction[]>(`${this.apiUrl}/promoted`, {
      params: { limit: limit.toString() },
    });
  }

  createAuction(auction: Partial<Auction>): Observable<Auction> {
    return this.http.post<Auction>(this.apiUrl, auction);
  }

  updateAuction(id: string, auction: Partial<Auction>): Observable<Auction> {
    return this.http.put<Auction>(`${this.apiUrl}/${id}`, auction);
  }

  deleteAuction(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}

