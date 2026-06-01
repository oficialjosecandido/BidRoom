import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface BlockStatus {
  blocked: boolean;
  userId: string;
}

export interface BlockedUser {
  _id: string;
  firstName: string;
  lastName: string;
  slug: string | null;
}

@Injectable({ providedIn: 'root' })
export class BlockService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/blocks`;

  getStatus(userId: string): Observable<BlockStatus> {
    return this.http.get<BlockStatus>(`${this.apiUrl}/status/${userId}`);
  }

  block(userId: string): Observable<BlockStatus> {
    return this.http.post<BlockStatus>(`${this.apiUrl}/${userId}`, {});
  }

  unblock(userId: string): Observable<BlockStatus> {
    return this.http.delete<BlockStatus>(`${this.apiUrl}/${userId}`);
  }

  getBlocked(): Observable<{ blocked: BlockedUser[] }> {
    return this.http.get<{ blocked: BlockedUser[] }>(this.apiUrl);
  }
}
