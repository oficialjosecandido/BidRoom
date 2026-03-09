import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';
import { loadStripe, Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js';

export interface FeeBreakdown {
  itemPrice: number;
  bidRoomFee: number;
  bidRoomFeeRate: number;
  stripeFee: number;
  stripeFeeRate: number;
  stripeFixedFee: number;
  totalChargedToBuyer: number;
  stripeAmountInCents: number;
  applicationFeeInCents: number;
  sellerPayout: number;
}

export interface Transaction {
  _id: string;
  invoiceNumber: string;
  listing: {
    _id: string;
    title: string;
    slug: string;
    images: string[];
    currentPrice: number;
    category?: string;
    condition?: string;
    shippingOption?: string;
    shippingCost?: number;
  };
  buyer: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  seller: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  currency: string;
  itemPrice: number;
  bidRoomFee: number;
  bidRoomFeeRate: number;
  stripeFee: number;
  stripeFeeRate: number;
  stripeFixedFee: number;
  totalChargedToBuyer: number;
  sellerPayout: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'disputed';
  stripePaymentIntentId: string | null;
  paymentInitiatedAt: string | null;
  paidAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectAccountStatus {
  connected: boolean;
  accountId: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
}

export interface PaymentIntentResponse {
  clientSecret: string;
  transactionId: string;
  fees: FeeBreakdown;
  stripePublicKey: string;
}

@Injectable({
  providedIn: 'root'
})
export class PaymentService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/payments`;
  private stripePromise: Promise<Stripe | null> | null = null;

  constructor(private http: HttpClient) {}

  // ── Stripe.js loader ──────────────────────────────────────────────────────

  async getStripe(publicKey: string): Promise<Stripe | null> {
    if (!this.stripePromise) {
      this.stripePromise = loadStripe(publicKey);
    }
    return this.stripePromise;
  }

  // ── Seller: Connect account ───────────────────────────────────────────────

  createConnectAccount(): Observable<ConnectAccountStatus & { alreadyExists: boolean }> {
    return this.http.post<ConnectAccountStatus & { alreadyExists: boolean }>(
      `${this.apiUrl}/connect/account`, {}
    );
  }

  getConnectAccountLink(): Observable<{ url: string; expiresAt: number }> {
    return this.http.post<{ url: string; expiresAt: number }>(
      `${this.apiUrl}/connect/account-link`, {}
    );
  }

  getConnectStatus(): Observable<ConnectAccountStatus> {
    return this.http.get<ConnectAccountStatus>(`${this.apiUrl}/connect/status`);
  }

  // ── Buyer: Payment ────────────────────────────────────────────────────────

  createPaymentIntent(listingId: string): Observable<PaymentIntentResponse> {
    return this.http.post<PaymentIntentResponse>(
      `${this.apiUrl}/create-payment-intent`, { listingId }
    );
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  getTransactions(params?: {
    role?: 'buyer' | 'seller';
    status?: string;
    limit?: number;
    skip?: number;
  }): Observable<{ transactions: Transaction[]; total: number; limit: number; skip: number }> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    return this.http.get<{ transactions: Transaction[]; total: number; limit: number; skip: number }>(
      `${this.apiUrl}/transactions`, { params: httpParams }
    );
  }

  getTransaction(id: string): Observable<{ transaction: Transaction; role: 'buyer' | 'seller' }> {
    return this.http.get<{ transaction: Transaction; role: 'buyer' | 'seller' }>(
      `${this.apiUrl}/transactions/${id}`
    );
  }

  // ── Fee preview ───────────────────────────────────────────────────────────

  previewFees(amount: number): Observable<FeeBreakdown> {
    return this.http.get<FeeBreakdown>(`${this.apiUrl}/fees`, {
      params: { amount: amount.toString() }
    });
  }
}
