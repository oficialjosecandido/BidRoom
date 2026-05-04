import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface FollowStatus {
  following: boolean;
  muted: boolean;
}

@Injectable({ providedIn: 'root' })
export class FollowService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/follows`;

  constructor(private http: HttpClient) {}

  getStatus(sellerId: string): Observable<FollowStatus> {
    return this.http.get<FollowStatus>(`${this.apiUrl}/status/${sellerId}`);
  }

  follow(sellerId: string): Observable<FollowStatus> {
    return this.http.post<FollowStatus>(`${this.apiUrl}/${sellerId}`, {});
  }

  unfollow(sellerId: string): Observable<FollowStatus> {
    return this.http.delete<FollowStatus>(`${this.apiUrl}/${sellerId}`);
  }

  setMuted(sellerId: string, muted: boolean): Observable<FollowStatus> {
    return this.http.patch<FollowStatus>(`${this.apiUrl}/${sellerId}/mute`, { muted });
  }
}
