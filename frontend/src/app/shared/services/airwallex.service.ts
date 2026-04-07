import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface AirwallexSellerStatus {
  accountId: string | null;
  kycStatus: 'pending' | 'in_review' | 'approved' | 'failed' | null;
  onboarded: boolean;
}

export interface AirwallexKycToken {
  token: string;
  expiresAt: string;
  alreadyOnboarded?: boolean;
}

export interface AirwallexPaymentIntent {
  intentId: string;
  clientSecret: string;
}

@Injectable({ providedIn: 'root' })
export class AirwallexService {
  private http = inject(HttpClient);
  private base = `${API_CONFIG.getApiUrl()}/airwallex`;

  /** Create (or fetch existing) connected account for the authenticated seller */
  onboard(): Observable<AirwallexSellerStatus> {
    return this.http.post<AirwallexSellerStatus>(`${this.base}/onboard`, {});
  }

  /** Get a short-lived KYC token to mount the embedded KYC widget */
  getKycToken(): Observable<AirwallexKycToken> {
    return this.http.get<AirwallexKycToken>(`${this.base}/kyc-token`);
  }

  /** Create a PaymentIntent for a transaction (buyer calls this) */
  createPaymentIntent(transactionId: string): Observable<AirwallexPaymentIntent> {
    return this.http.post<AirwallexPaymentIntent>(`${this.base}/payment-intent`, { transactionId });
  }
}
