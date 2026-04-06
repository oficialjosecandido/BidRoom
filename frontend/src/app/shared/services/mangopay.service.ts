import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface MangoPaySellerStatus {
  mangoPayOnboarded: boolean;
  mangoPayUserId: string | null;
  mangoPayWalletId: string | null;
  mangoPayBankAccountId: string | null;
  mangoPayKycLevel: 'LIGHT' | 'REGULAR';
}

export interface MangoPaySetupData {
  dobDay: number;
  dobMonth: number;
  dobYear: number;
  addressLine1: string;
  addressCity: string;
  addressPostal: string;
  addressCountry: string;
  iban: string;
  bic?: string;
}

export interface MangoPaySetupResponse {
  mangoPayOnboarded: boolean;
  mangoPayUserId: string;
  mangoPayWalletId: string;
  mangoPayBankAccountId: string;
}

export interface CardRegistrationData {
  Id: string;
  AccessKey: string;
  PreregistrationData: string;
  CardRegistrationURL: string;
  Currency: string;
  CardType: string;
}

export interface PayInResponse {
  transactionId: string;
  payInId: string;
  status: 'CREATED' | 'SUCCEEDED' | 'FAILED';
  redirectUrl?: string;          // set when 3DS is required
  secureModeRedirectURL?: string;
}

export interface PayInStatusResponse {
  payInId: string;
  status: 'CREATED' | 'SUCCEEDED' | 'FAILED';
  transactionStatus: string;
  resultCode?: string;
  resultMessage?: string;
}

declare const MangoPay: any;

@Injectable({ providedIn: 'root' })
export class MangopayService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/mangopay`;

  // ── Seller ──────────────────────────────────────────────────────────────────

  getSellerStatus(): Observable<MangoPaySellerStatus> {
    return this.http.get<MangoPaySellerStatus>(`${this.apiUrl}/seller/status`);
  }

  setupSeller(data: MangoPaySetupData): Observable<MangoPaySetupResponse> {
    return this.http.post<MangoPaySetupResponse>(`${this.apiUrl}/seller/setup`, data);
  }

  updateIban(iban: string, bic?: string): Observable<MangoPaySetupResponse> {
    return this.http.post<MangoPaySetupResponse>(`${this.apiUrl}/seller/update-iban`, { iban, bic });
  }

  // ── Buyer payment ────────────────────────────────────────────────────────────

  getCardRegistration(transactionId: string): Observable<CardRegistrationData> {
    return this.http.post<CardRegistrationData>(`${this.apiUrl}/payment/card-registration`, { transactionId });
  }

  createPayIn(transactionId: string, registrationData: string, returnUrl: string): Observable<PayInResponse> {
    return this.http.post<PayInResponse>(`${this.apiUrl}/payment/pay-in`, {
      transactionId,
      registrationData,
      returnUrl
    });
  }

  pollPayIn(payInId: string, transactionId: string): Observable<PayInStatusResponse> {
    return this.http.get<PayInStatusResponse>(`${this.apiUrl}/payment/pay-in/${payInId}?transactionId=${transactionId}`);
  }

  /**
   * Tokenize a card using MangoPay.js (must be loaded in index.html).
   * Returns the RegistrationData string to pass to createPayIn().
   */
  tokenizeCard(
    registration: CardRegistrationData,
    cardNumber: string,
    expiryDate: string,
    cvx: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (typeof MangoPay === 'undefined') {
        reject(new Error('MangoPay.js is not loaded'));
        return;
      }

      MangoPay.cardRegistration.init({
        cardRegistrationURL: registration.CardRegistrationURL,
        preregistrationData: registration.PreregistrationData,
        accessKey: registration.AccessKey,
        Id: registration.Id
      });

      MangoPay.cardRegistration.registerCard(
        { cardNumber, cardExpirationDate: expiryDate, cardCvx: cvx, cardType: registration.CardType },
        (resp: { RegistrationData: string }) => resolve(resp.RegistrationData),
        (err: any) => reject(new Error(err?.ResultMessage || err?.message || 'Card tokenization failed'))
      );
    });
  }

  get isSandbox(): boolean {
    // If MANGOPAY_CLIENT_ID starts with sandbox pattern or API is not production
    return !window.location.hostname.includes('bidroom.com');
  }
}
