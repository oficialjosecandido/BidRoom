import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface Notification {
  _id: string;
  user: string;
  title: string;
  message: string;
  type: 'proposal' | 'bid' | 'auction_ended' | 'transaction' | 'dispute' | 'review' | 'listing' | 'watchlist' | 'private_room' | 'shipping' | 'account' | 'security' | 'system';
  link?: string | null;
  referenceId?: string | null;
  status: 'unread' | 'read';
  issuedAt: string;
  readAt?: string | null;
}

export interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/notifications`;

  getNotifications(params?: { limit?: number; skip?: number; status?: 'unread' | 'read' }): Observable<NotificationsResponse> {
    const p = new URLSearchParams();
    if (params?.limit) p.set('limit', String(params.limit));
    if (params?.skip) p.set('skip', String(params.skip));
    if (params?.status) p.set('status', params.status);
    const query = p.toString();
    return this.http.get<NotificationsResponse>(`${this.apiUrl}${query ? '?' + query : ''}`);
  }

  getUnreadCount(): Observable<{ unreadCount: number }> {
    return this.http.get<{ unreadCount: number }>(`${this.apiUrl}/unread-count`);
  }

  markAsRead(notificationId: string): Observable<Notification> {
    return this.http.patch<Notification>(`${this.apiUrl}/${notificationId}/read`, {});
  }

  markAllAsRead(): Observable<{ modifiedCount: number }> {
    return this.http.patch<{ modifiedCount: number }>(`${this.apiUrl}/read-all`, {});
  }
}
