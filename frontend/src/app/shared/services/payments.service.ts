import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface CreateCheckoutSessionResponse {
  url: string;
}

export interface ConfirmSessionResponse {
  success: boolean;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PaymentsService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/payments`;

  constructor(private http: HttpClient) {}

  createCheckoutSession(amountDollars: number): Observable<CreateCheckoutSessionResponse> {
    return this.http.post<CreateCheckoutSessionResponse>(
      `${this.apiUrl}/create-checkout-session`,
      { amountDollars }
    );
  }

  confirmSession(sessionId: string): Observable<ConfirmSessionResponse> {
    return this.http.post<ConfirmSessionResponse>(
      `${this.apiUrl}/confirm-session`,
      { session_id: sessionId }
    );
  }
}
