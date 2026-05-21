import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
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

/** Buyer/seller transaction-related in-app notification types */
export const TRANSACTION_RELATED_NOTIFICATION_TYPES: Notification['type'][] = [
  'bid',
  'auction_ended',
  'transaction',
  'shipping',
  'dispute',
  'review',
  'listing',
];

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/notifications`;

  private readonly unreadCountSubject = new BehaviorSubject<number>(0);
  /** Emits whenever the global unread count should refresh (badges, headers). */
  readonly unreadCount$ = this.unreadCountSubject.asObservable();

  getNotifications(params?: { limit?: number; skip?: number; status?: 'unread' | 'read' }): Observable<NotificationsResponse> {
    const p = new URLSearchParams();
    if (params?.limit) p.set('limit', String(params.limit));
    if (params?.skip) p.set('skip', String(params.skip));
    if (params?.status) p.set('status', params.status);
    const query = p.toString();
    return this.http.get<NotificationsResponse>(`${this.apiUrl}${query ? '?' + query : ''}`);
  }

  getUnreadCount(types?: string[]): Observable<{ unreadCount: number }> {
    const p = new URLSearchParams();
    if (types?.length) p.set('types', types.join(','));
    const query = p.toString();
    return this.http.get<{ unreadCount: number }>(`${this.apiUrl}/unread-count${query ? '?' + query : ''}`);
  }

  /** Refresh and broadcast global unread badge count. */
  refreshUnreadCount(): void {
    this.getUnreadCount().subscribe({
      next: (r) => this.unreadCountSubject.next(r.unreadCount ?? 0),
      error: () => this.unreadCountSubject.next(0)
    });
  }

  markAsRead(notificationId: string): Observable<Notification> {
    return this.http.patch<Notification>(`${this.apiUrl}/${notificationId}/read`, {}).pipe(
      tap(() => this.refreshUnreadCount())
    );
  }

  markAllAsRead(types?: string[]): Observable<{ modifiedCount: number }> {
    const p = new URLSearchParams();
    if (types?.length) p.set('types', types.join(','));
    const query = p.toString();
    return this.http.patch<{ modifiedCount: number }>(`${this.apiUrl}/read-all${query ? '?' + query : ''}`, {}).pipe(
      tap(() => {
        if (!types?.length) {
          this.unreadCountSubject.next(0);
        } else {
          this.refreshUnreadCount();
        }
      })
    );
  }
}
