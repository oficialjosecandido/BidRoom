import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';

export interface UserStats {
  totalItemsSold: number;
  totalItemsBought: number;
  totalValueSold: number;
  totalValueBought: number;
  totalBidsPlaced: number;
  totalAuctionsWon: number;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  outbid: boolean;
  auctionEnding: boolean;
  messages: boolean;
  disputes: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private apiUrl = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  getProfile(): Observable<any> {
    return this.http.get(`${this.apiUrl}/me`);
  }

  updateProfile(profile: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/me`, profile);
  }

  getStats(): Observable<UserStats> {
    return this.http.get<UserStats>(`${this.apiUrl}/me/stats`);
  }

  getNotificationPreferences(): Observable<NotificationPreferences> {
    return this.http.get<NotificationPreferences>(`${this.apiUrl}/me/notifications`);
  }

  updateNotificationPreferences(preferences: NotificationPreferences): Observable<NotificationPreferences> {
    return this.http.put<NotificationPreferences>(`${this.apiUrl}/me/notifications`, preferences);
  }

  getPaymentMethods(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/me/payment-methods`);
  }

  addPaymentMethod(paymentMethod: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/me/payment-methods`, paymentMethod);
  }

  removePaymentMethod(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/me/payment-methods/${id}`);
  }

  updatePreAuth(): Observable<any> {
    return this.http.post(`${this.apiUrl}/me/pre-auth`, {});
  }
}

