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
  requirementErrors?: string[];
}

export interface OnboardingFormData {
  dobDay: number;
  dobMonth: number;
  dobYear: number;
  addressLine1: string;
  addressCity: string;
  addressPostal: string;
  addressCountry: string;
  iban: string;
  tosAccepted: boolean;
}

export interface OnboardingSubmitResponse {
  onboarded: boolean;
  requiresVerification: boolean;
  accountId: string;
}

export interface ConnectCheckoutResponse {
  url: string;
}

export interface ConnectOnboardingLinkResponse {
  url: string;
  accountId: string;
}

@Injectable({ providedIn: 'root' })
export class StripeConnectService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/connect`;

  getAccountStatus(): Observable<ConnectAccountStatus> {
    return this.http.get<ConnectAccountStatus>(`${this.apiUrl}/account-status`);
  }

  createOnboardingLink(country = 'PT'): Observable<ConnectOnboardingLinkResponse> {
    return this.http.post<ConnectOnboardingLinkResponse>(`${this.apiUrl}/onboarding-link`, { country });
  }

  submitOnboarding(data: OnboardingFormData): Observable<OnboardingSubmitResponse> {
    return this.http.post<OnboardingSubmitResponse>(`${this.apiUrl}/submit-onboarding`, data);
  }

  createCheckoutSession(transactionId: string): Observable<ConnectCheckoutResponse> {
    return this.http.post<ConnectCheckoutResponse>(`${this.apiUrl}/create-checkout-session`, { transactionId });
  }

  confirmPayment(sessionId: string, transactionId: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/confirm-payment`, { sessionId, transactionId });
  }

  testActivate(): Observable<ConnectAccountStatus> {
    return this.http.post<ConnectAccountStatus>(`${this.apiUrl}/test-activate`, {});
  }

  get isTestMode(): boolean {
    return API_CONFIG.getStripePublishableKey().startsWith('pk_test_');
  }
}
