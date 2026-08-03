import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export type VtStatus =
  | 'awaiting_setup'
  | 'in_progress'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DepositStatus = 'pending' | 'authorized' | 'requires_action' | 'released' | 'captured' | 'expired' | 'failed';
export type FeeStatus = 'pending' | 'paid' | 'requires_action' | 'failed';

export interface VehicleTransaction {
  _id: string;
  listing: {
    _id: string;
    title: string;
    slug: string;
    category: string;
    images: string[];
    currentPrice: number;
  };
  buyer: { _id: string; firstName: string; lastName: string; email?: string };
  seller: { _id: string; firstName: string; lastName: string; email?: string };
  agreedPrice: number;
  deposit: {
    amount: number;
    status: DepositStatus;
    authorizedAt?: string | null;
    resolvedAt?: string | null;
    clientSecret?: string | null;
  };
  sellerFee: {
    amount: number;
    status: FeeStatus;
    paidAt?: string | null;
    clientSecret?: string | null;
  };
  completion: {
    buyerConfirmed: boolean;
    sellerConfirmed: boolean;
    buyerConfirmedAt?: string | null;
    sellerConfirmedAt?: string | null;
    firstConfirmationAt?: string | null;
    registrationProofUrl?: string | null;
    registrationProofUploadedAt?: string | null;
    contested?: boolean;
    contestedBy?: 'buyer' | 'seller' | null;
    contestReason?: string | null;
  };
  status: VtStatus;
  failureReason?: string | null;
  setupDeadline: string;
  transactionDeadline: string;
  confirmationDeadline?: string | null;
  role: 'buyer' | 'seller';
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizeResult {
  status: 'authorized' | 'paid' | 'requires_action' | 'failed' | 'no_payment_method';
  clientSecret?: string;
}

@Injectable({ providedIn: 'root' })
export class VehicleTransactionService {
  private http = inject(HttpClient);
  private api = `${API_CONFIG.getApiUrl()}/vehicle-transactions`;

  getAll(): Observable<{ vehicleTransactions: Partial<VehicleTransaction>[] }> {
    return this.http.get<{ vehicleTransactions: Partial<VehicleTransaction>[] }>(this.api);
  }

  get(vtId: string): Observable<VehicleTransaction> {
    return this.http.get<VehicleTransaction>(`${this.api}/${vtId}`);
  }

  authorizeDeposit(vtId: string): Observable<AuthorizeResult> {
    return this.http.post<AuthorizeResult>(`${this.api}/${vtId}/authorize-deposit`, {});
  }

  confirmDeposit(vtId: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.api}/${vtId}/confirm-deposit`, {});
  }

  payFee(vtId: string): Observable<AuthorizeResult> {
    return this.http.post<AuthorizeResult>(`${this.api}/${vtId}/pay-fee`, {});
  }

  confirmFee(vtId: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.api}/${vtId}/confirm-fee`, {});
  }

  confirmCompletion(vtId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.api}/${vtId}/confirm-completion`, {});
  }

  uploadRegistrationProof(vtId: string, proofUrl: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.api}/${vtId}/registration-proof`, { proofUrl });
  }
}
