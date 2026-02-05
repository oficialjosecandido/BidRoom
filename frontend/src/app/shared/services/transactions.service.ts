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
  createdAt: string;
  updatedAt: string;
  role?: 'seller' | 'buyer';
}

export interface TransactionsResponse {
  transactions: Transaction[];
}

@Injectable({
  providedIn: 'root'
})
export class TransactionsService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/transactions`;

  constructor(private http: HttpClient) {}

  getMyTransactions(): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>(this.apiUrl);
  }

  getTransaction(id: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${this.apiUrl}/${id}`);
  }

  updateTransaction(
    id: string,
    body: { status?: TransactionStatus; trackingNumber?: string; trackingCarrier?: string }
  ): Observable<Transaction> {
    return this.http.patch<Transaction>(`${this.apiUrl}/${id}`, body);
  }
}
