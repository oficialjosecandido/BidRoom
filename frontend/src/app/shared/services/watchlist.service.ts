import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';
import { Listing } from './listings.service';

export interface WatchlistResponse {
  watchlist: (Listing & { addedAt?: string })[];
  total: number;
}

export interface WatchlistCheckResponse {
  inWatchlist: boolean;
}

export interface WatchlistActionResponse {
  success: boolean;
  message: string;
  inWatchlist: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class WatchlistService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/watchlist`;

  constructor(private http: HttpClient) {}

  add(listingId: string): Observable<WatchlistActionResponse> {
    return this.http.post<WatchlistActionResponse>(this.apiUrl, { listingId });
  }

  remove(listingId: string): Observable<WatchlistActionResponse> {
    return this.http.delete<WatchlistActionResponse>(`${this.apiUrl}/${listingId}`);
  }

  getMyWatchlist(): Observable<WatchlistResponse> {
    return this.http.get<WatchlistResponse>(this.apiUrl);
  }

  checkInWatchlist(listingId: string): Observable<WatchlistCheckResponse> {
    return this.http.get<WatchlistCheckResponse>(`${this.apiUrl}/check/${listingId}`);
  }
}
