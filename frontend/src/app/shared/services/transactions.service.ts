import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export type TransactionStatus =
  | 'pending_payment'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export interface TransactionListing {
  _id: string;
  title: string;
  slug: string;
  images?: string[];
  status: string;
}

export interface TransactionUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface Transaction {
  _id: string;
  listing: TransactionListing;
  seller: TransactionUser;
  buyer: TransactionUser;
  winnerBid: string;
  amount: number;
  /** Overall state (preferred). Backend may still send legacy `status` for old docs. */
  transactionStatus?: TransactionStatus;
  paymentStatus?: 'pending' | 'paid';
  sendingStatus?: 'pending' | 'shipped' | 'delivered';
  /** @deprecated Use transactionStatus */
  status?: TransactionStatus;
  paidAt: string | null;
  shippedAt: string | null;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  notes: string | null;
  /** Payment window deadline (T+24h); seller adds bank details, buyer pays by this time */
  paymentDeadline?: string | null;
  /** Seller bank details for this transaction (buyer uses for transfer) */
  sellerBankIban?: string | null;
  sellerBankSwift?: string | null;
  sellerBankAccountName?: string | null;
  /** Buyer optional proof of payment URL when marking paid */
  buyerProofOfPaymentUrl?: string | null;
  /** Seller optional proof of delivery URL when marking shipped */
  sellerProofOfDeliveryUrl?: string | null;
  /** Date by which seller must ship (after paid) */
  handlingDeadline?: string | null;
  createdAt: string;
  updatedAt: string;
  role?: 'seller' | 'buyer';
}

export interface TransactionsResponse {
  transactions: Transaction[];
}

const PROOF_MAX_SIZE = 30 * 1024 * 1024; // 30MB
const PROOF_ACCEPT = '.pdf,.jpg,.jpeg,.png';

@Injectable({
  providedIn: 'root'
})
export class TransactionsService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/transactions`;
  private uploadsUrl = `${API_CONFIG.getApiUrl()}/uploads`;

  constructor(private http: HttpClient) {}

  /** Accepted file types and max size for proof of payment (for use in file input). */
  get proofOfPaymentAccept(): string {
    return PROOF_ACCEPT;
  }
  get proofOfPaymentMaxSize(): number {
    return PROOF_MAX_SIZE;
  }

  /** Upload a single proof-of-payment file (PDF, JPG or PNG, max 30MB). Returns the blob URL. */
  uploadProofOfPayment(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${this.uploadsUrl}/proof-of-payment`, formData);
  }

  /** Upload proof of delivery (PDF, JPG or PNG, max 30MB). Returns the blob URL. */
  uploadProofOfDelivery(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${this.uploadsUrl}/proof-of-delivery`, formData);
  }

  getMyTransactions(): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>(this.apiUrl);
  }

  getTransaction(id: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${this.apiUrl}/${id}`);
  }

  updateTransaction(
    id: string,
    body: {
      status?: TransactionStatus;
      trackingNumber?: string;
      trackingCarrier?: string;
      sellerBankIban?: string;
      sellerBankSwift?: string;
      sellerBankAccountName?: string;
      buyerProofOfPaymentUrl?: string;
      sellerProofOfDeliveryUrl?: string;
    }
  ): Observable<Transaction> {
    return this.http.patch<Transaction>(`${this.apiUrl}/${id}`, body);
  }
}
