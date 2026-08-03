import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';
import { loadStripe, Stripe, StripeCardElement } from '@stripe/stripe-js';

export interface DepositStatus {
  depositRequired: boolean;
  depositStatus: 'pending' | 'authorized' | 'released' | 'captured';
  depositDeadline: string | null;
  depositAuthorizedAt: string | null;
  depositCapturedAt: string | null;
  depositReleasedAt: string | null;
}

export interface AuthorizeDepositResponse {
  clientSecret: string;
  requiresPaymentMethod: boolean;
  savedCard: { brand: string; last4: string; expiry: string } | null;
}

@Injectable({ providedIn: 'root' })
export class DepositService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/deposits`;

  private _stripe: Stripe | null = null;

  async getStripe(): Promise<Stripe | null> {
    if (this._stripe) return this._stripe;
    const key = API_CONFIG.getStripePublishableKey();
    if (!key) return null;
    this._stripe = await loadStripe(key);
    return this._stripe;
  }

  getDepositStatus(txId: string): Observable<DepositStatus> {
    return this.http.get<DepositStatus>(`${this.apiUrl}/${txId}`);
  }

  authorizeDeposit(txId: string): Observable<AuthorizeDepositResponse> {
    return this.http.post<AuthorizeDepositResponse>(`${this.apiUrl}/${txId}/authorize`, {});
  }

  confirmDeposit(txId: string): Observable<{ success: boolean; depositStatus: string; depositDeadline: string }> {
    return this.http.post<{ success: boolean; depositStatus: string; depositDeadline: string }>(
      `${this.apiUrl}/${txId}/confirm`, {}
    );
  }

  releaseDeposit(txId: string): Observable<{ success: boolean; depositStatus: string }> {
    return this.http.post<{ success: boolean; depositStatus: string }>(
      `${this.apiUrl}/${txId}/release`, {}
    );
  }

  /**
   * Full authorize + Stripe confirm flow.
   * Returns null on success, or an error message string.
   */
  async authorizeAndConfirm(
    txId: string,
    cardElement: StripeCardElement | null
  ): Promise<string | null> {
    const stripe = await this.getStripe();
    if (!stripe) return 'Stripe não disponível';

    let authorizeResp: AuthorizeDepositResponse;
    try {
      authorizeResp = await new Promise((resolve, reject) => {
        this.authorizeDeposit(txId).subscribe({ next: resolve, error: reject });
      });
    } catch {
      return 'Erro ao iniciar a autorização da caução.';
    }

    const { clientSecret, requiresPaymentMethod } = authorizeResp;

    const confirmParams: Parameters<Stripe['confirmCardPayment']>[1] = {};
    if (requiresPaymentMethod && cardElement) {
      confirmParams.payment_method = { card: cardElement };
    }

    const { error } = await stripe.confirmCardPayment(clientSecret, confirmParams);
    if (error) {
      return error.message ?? 'Erro ao autorizar a caução.';
    }

    try {
      await new Promise<void>((resolve, reject) => {
        this.confirmDeposit(txId).subscribe({ next: () => resolve(), error: reject });
      });
    } catch {
      return 'Caução autorizada no Stripe mas erro ao confirmar no servidor.';
    }

    return null;
  }
}
