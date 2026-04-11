import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_CONFIG } from '../config/api.config';

export type TransactionStatus =
  | 'pending_payment'
  | 'awaiting_seller_acceptance'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'under_dispute'
  | 'completed'
  | 'cancelled';

export interface TransactionListing {
  _id: string;
  title: string;
  slug: string;
  images?: string[];
  status: string;
  /** Commission rate (0.005 = 0.5%, 0.02 = 2%) */
  commissionRate?: number;
  /** Shipping cost in $ (flat-rate); 0 for free/local-pickup */
  shippingCost?: number;
  /** flat-rate | calculated | local-pickup | free */
  shippingOption?: string;
  /** Package size for calculated shipping */
  packageSize?: 'small' | 'medium' | 'large' | null;
  /** Origin postal code for calculated shipping */
  shippingOriginPostalCode?: string | null;
  /** Auction format: highest-bid | best-offer */
  auctionFormat?: 'highest-bid' | 'best-offer';
  /** Whether the listing allowed a private room (affects commission rate) */
  allowPrivateRoom?: boolean;
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
  /** Deadline for seller to accept payment (5 days from buyer marks as paid) */
  paymentAcceptanceDeadline?: string | null;
  /** Date by which seller must ship (after paid) */
  handlingDeadline?: string | null;
  /** End of 5th business day after payment — auto-cancel if not shipped */
  shipByBusinessDeadline?: string | null;
  shippingMidpointWarningSentAt?: string | null;
  buyerRemindSellerShipAt?: string | null;
  shippingAutoCancelledAt?: string | null;
  /** Whether buyer has reviewed seller (for this listing) */
  buyerHasReviewedSeller?: boolean;
  /** Whether seller has reviewed buyer (for this listing) */
  sellerHasReviewedBuyer?: boolean;
  /** Stripe Connect payment fields */
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  /** Stripe refund ID (set by auto-cancel scheduler or dispute ruling) */
  stripeRefundId?: string | null;
  /** BidRoom platform fee charged to buyer (2% of item price, dollars) */
  bidRoomFeeAmount?: number | null;
  /** Stripe processing fee deducted from seller payout (dollars) */
  stripeFeeAmount?: number | null;
  /** Total charged to buyer including BidRoom fee and shipping (dollars) */
  buyerTotalPaid?: number | null;
  /** Final payout to seller (dollars) */
  sellerPayoutAmount?: number | null;
  /** Locked shipping amount for calculated shipping (dollars) */
  shippingAmount?: number | null;
  /** Carrier name for locked rate */
  shippingCarrier?: string | null;
  /** Service level for locked rate */
  shippingService?: string | null;
  /** Estimated delivery days */
  shippingDeliveryDays?: number | null;
  /** Buyer delivery address */
  buyerDeliveryAddress?: {
    street1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  /** Whether a dispute has been opened for this transaction */
  disputeOpen?: boolean;
  disputeOpenedAt?: string | null;
  disputeOpenedBy?: 'buyer' | 'seller' | null;
  disputeReason?: string | null;
  disputeExplanation?: string | null;
  disputeBuyerMediaUrls?: string[];
  disputeSellerCounterMediaUrls?: string[];
  disputeAdminVerdict?: 'buyer_refund' | 'seller_payout' | 'partial_refund' | null;
  disputeRefundAmount?: number | null;
  disputeRuledAt?: string | null;
  disputeAdminNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  role?: 'seller' | 'buyer';
}

export interface TransactionsResponse {
  transactions: Transaction[];
}

const PROOF_MAX_SIZE = 30 * 1024 * 1024; // 30MB
const PROOF_ACCEPT = '.pdf,.jpg,.jpeg,.png';
const DISPUTE_EVIDENCE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.mp4,.webm';

@Injectable({
  providedIn: 'root'
})
export class TransactionsService {
  private http = inject(HttpClient);

  private apiUrl = `${API_CONFIG.getApiUrl()}/transactions`;
  private uploadsUrl = `${API_CONFIG.getApiUrl()}/uploads`;

  /** Accepted file types and max size for proof of payment (for use in file input). */
  get proofOfPaymentAccept(): string {
    return PROOF_ACCEPT;
  }
  get proofOfPaymentMaxSize(): number {
    return PROOF_MAX_SIZE;
  }
  get disputeEvidenceAccept(): string {
    return DISPUTE_EVIDENCE_ACCEPT;
  }

  /** Upload dispute evidence (images, PDF, or video, max 30MB). Returns the blob URL. */
  uploadDisputeEvidence(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${this.uploadsUrl}/dispute-evidence`, formData);
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

  /** Returns counts of active (non-completed/cancelled) transactions per role. */
  getPendingCounts(): Observable<{ buyer: number; seller: number }> {
    return this.getMyTransactions().pipe(
      map(({ transactions }) => {
        const DONE = new Set(['completed', 'cancelled']);
        let buyer = 0, seller = 0;
        for (const t of transactions) {
          const status = t.transactionStatus ?? t.status ?? '';
          if (DONE.has(status)) continue;
          if (t.role === 'buyer') buyer++;
          else if (t.role === 'seller') seller++;
        }
        return { buyer, seller };
      })
    );
  }

  getTransaction(id: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${this.apiUrl}/${id}`);
  }

  updateTransaction(
    id: string,
    body: {
      status?: TransactionStatus | 'accept_payment';
      trackingNumber?: string;
      trackingCarrier?: string;
      sellerBankIban?: string;
      sellerBankSwift?: string;
      sellerBankAccountName?: string;
      buyerProofOfPaymentUrl?: string;
      sellerProofOfDeliveryUrl?: string;
      disputeOpen?: boolean;
      disputeReason?: string;
    }
  ): Observable<Transaction> {
    return this.http.patch<Transaction>(`${this.apiUrl}/${id}`, body);
  }

  /** Open a formal dispute (buyer only, status must be shipped). */
  openDispute(
    id: string,
    payload: { reason: string; explanation: string; mediaUrls: string[] }
  ): Observable<Transaction> {
    return this.http.post<Transaction>(`${this.apiUrl}/${id}/open-dispute`, payload);
  }

  /** Upload seller counter-evidence. */
  updateDisputeCounterEvidence(id: string, mediaUrls: string[]): Observable<Transaction> {
    return this.http.patch<Transaction>(`${this.apiUrl}/${id}/dispute/counter-evidence`, {
      mediaUrls
    });
  }

  /** Download invoice (seller) or receipt (buyer) PDF for a completed transaction. */
  getInvoice(id: string, role: 'seller' | 'buyer'): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/invoice?role=${role}`, {
      responseType: 'blob'
    });
  }

  /** Buyer: remind seller to ship (24h cooldown). */
  remindSellerToShip(id: string): Observable<Transaction> {
    return this.http.post<Transaction>(`${this.apiUrl}/${id}/remind-ship`, {});
  }
}
