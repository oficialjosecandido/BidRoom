import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface CategoryFollowStatus {
  following: boolean;
  category: string;
  muted?: boolean;
}

export interface FollowedCategory {
  category: string;
  muted: boolean;
}

@Injectable({ providedIn: 'root' })
export class CategoryFollowService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/category-follows`;

  getStatus(category: string): Observable<CategoryFollowStatus> {
    return this.http.get<CategoryFollowStatus>(`${this.apiUrl}/status/${encodeURIComponent(category)}`);
  }

  follow(category: string): Observable<CategoryFollowStatus> {
    return this.http.post<CategoryFollowStatus>(`${this.apiUrl}/${encodeURIComponent(category)}`, {});
  }

  unfollow(category: string): Observable<CategoryFollowStatus> {
    return this.http.delete<CategoryFollowStatus>(`${this.apiUrl}/${encodeURIComponent(category)}`);
  }

  getFollowedCategories(): Observable<{ categories: FollowedCategory[] }> {
    return this.http.get<{ categories: FollowedCategory[] }>(this.apiUrl);
  }

  setMuted(category: string, muted: boolean): Observable<CategoryFollowStatus> {
    return this.http.patch<CategoryFollowStatus>(`${this.apiUrl}/${encodeURIComponent(category)}/mute`, { muted });
  }
}
