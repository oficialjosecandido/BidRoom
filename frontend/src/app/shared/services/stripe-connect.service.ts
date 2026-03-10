import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface ConnectAccountStatus {
  connected: boolean;
  onboarded: boolean;
  accountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
}

export interface ConnectOnboardResponse {
  url: string;
}

export interface ConnectCheckoutResponse {
  url: string;
}

@Injectable({ providedIn: 'root' })
export class StripeConnectService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/connect`;

  getAccountStatus(): Observable<ConnectAccountStatus> {
    return this.http.get<ConnectAccountStatus>(`${this.apiUrl}/account-status`);
  }

  startOnboarding(): Observable<ConnectOnboardResponse> {
    return this.http.post<ConnectOnboardResponse>(`${this.apiUrl}/onboard`, {});
  }

  createCheckoutSession(transactionId: string): Observable<ConnectCheckoutResponse> {
    return this.http.post<ConnectCheckoutResponse>(`${this.apiUrl}/create-checkout-session`, { transactionId });
  }

  confirmPayment(sessionId: string, transactionId: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/confirm-payment`, { sessionId, transactionId });
  }
}
