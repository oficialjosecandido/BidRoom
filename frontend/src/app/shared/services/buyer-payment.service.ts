import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface SetupIntentResponse {
  clientSecret: string;
  customerId: string;
}

export interface PaymentMethodResponse {
  saved: boolean;
  brand?: string;
  last4?: string;
  expiry?: string;
  trustTier: number;
}

export interface DeletePaymentMethodResponse {
  success: boolean;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class BuyerPaymentService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/payments`;

  createSetupIntent(): Observable<SetupIntentResponse> {
    return this.http.post<SetupIntentResponse>(`${this.apiUrl}/setup-intent`, {});
  }

  getPaymentMethod(): Observable<PaymentMethodResponse> {
    return this.http.get<PaymentMethodResponse>(`${this.apiUrl}/payment-method`);
  }

  deletePaymentMethod(): Observable<DeletePaymentMethodResponse> {
    return this.http.delete<DeletePaymentMethodResponse>(`${this.apiUrl}/payment-method`);
  }
}
