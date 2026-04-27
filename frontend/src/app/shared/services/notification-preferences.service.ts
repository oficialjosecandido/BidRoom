import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface NotificationChannelPref {
  email: boolean;
  push: boolean;
  inApp: boolean;
}

export interface NotificationPreferences {
  globalEmailUnsubscribed: boolean;
  outbid: NotificationChannelPref;
  auctionEndingSoon: NotificationChannelPref;
  auctionWon: NotificationChannelPref;
  offerReceived: NotificationChannelPref;
  offerAccepted: NotificationChannelPref;
  dispatch: NotificationChannelPref;
  paymentReceived: NotificationChannelPref;
  newBid: NotificationChannelPref;
  disputeUpdate: NotificationChannelPref;
}

export const DEFAULT_CHANNEL_PREF: NotificationChannelPref = { email: true, push: true, inApp: true };

export const NOTIFICATION_EVENT_KEYS: (keyof Omit<NotificationPreferences, 'globalEmailUnsubscribed'>)[] = [
  'outbid', 'auctionEndingSoon', 'auctionWon',
  'offerReceived', 'offerAccepted', 'dispatch',
  'paymentReceived', 'newBid', 'disputeUpdate'
];

@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private http = inject(HttpClient);
  private apiUrl = API_CONFIG.getApiUrl();

  getPreferences(): Observable<NotificationPreferences> {
    return this.http.get<NotificationPreferences>(`${this.apiUrl}/notifications/preferences`);
  }

  updatePreferences(prefs: Partial<NotificationPreferences>): Observable<NotificationPreferences> {
    return this.http.patch<NotificationPreferences>(`${this.apiUrl}/notifications/preferences`, prefs);
  }
}
