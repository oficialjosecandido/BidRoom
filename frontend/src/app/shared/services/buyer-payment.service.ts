import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface SetupIntentResponse {
  clientSecret: string;
  customerId: string;
}

export interface SavedPaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expiry: string;
  isDefault: boolean;
}

export interface PaymentMethodsResponse {
  saved: boolean;
  methods: SavedPaymentMethod[];
  trustTier: number;
}

export interface DeletePaymentMethodResponse {
  success: boolean;
  saved: boolean;
  methods: SavedPaymentMethod[];
  trustTier: number;
}

@Injectable({ providedIn: 'root' })
export class BuyerPaymentService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/payments`;

  createSetupIntent(): Observable<SetupIntentResponse> {
    return this.http.post<SetupIntentResponse>(`${this.apiUrl}/setup-intent`, {});
  }

  getPaymentMethods(): Observable<PaymentMethodsResponse> {
    return this.http.get<PaymentMethodsResponse>(`${this.apiUrl}/payment-method`);
  }

  confirmPaymentMethod(setupIntentId: string): Observable<PaymentMethodsResponse> {
    return this.http.post<PaymentMethodsResponse>(`${this.apiUrl}/payment-method/confirm`, { setupIntentId });
  }

  setDefaultPaymentMethod(paymentMethodId: string): Observable<PaymentMethodsResponse> {
    return this.http.patch<PaymentMethodsResponse>(
      `${this.apiUrl}/payment-method/${encodeURIComponent(paymentMethodId)}/default`,
      {}
    );
  }

  deletePaymentMethod(paymentMethodId: string): Observable<DeletePaymentMethodResponse> {
    return this.http.delete<DeletePaymentMethodResponse>(
      `${this.apiUrl}/payment-method/${encodeURIComponent(paymentMethodId)}`
    );
  }
}
