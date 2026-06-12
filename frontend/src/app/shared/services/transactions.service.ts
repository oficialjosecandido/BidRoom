import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_CONFIG } from '../config/api.config';

export type TransactionStatus =
  | 'pending_payment'
  | 'awaiting_seller_acceptance'
  | 'manual_payment_sent'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'under_dispute'
  | 'completed'
  | 'cancelled';

export interface SellerPaymentConfig {
  inPerson?: boolean;
  bankTransfer?: {
    enabled?: boolean;
    iban?: string | null;
    accountName?: string | null;
  };
  mbway?: {
    enabled?: boolean;
    phone?: string | null;
  };
}

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
  /** Return policy: 30-days | 14-days | 7-days | no-returns */
  returnPolicy?: string | null;
  /** Payment methods accepted for this listing */
  acceptedPaymentMethods?: {
    stripe?: boolean;
    inPerson?: boolean;
    bankTransfer?: boolean;
    mbway?: boolean;
  };
}

export interface TransactionUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  sellerPaymentConfig?: SellerPaymentConfig;
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
  /** Estimated delivery date (shippedAt + delivery days) */
  estimatedDeliveryDate?: string | null;
  /** When buyer confirmed receipt */
  deliveredAt?: string | null;
  /** Cutoff for auto-release if buyer doesn't confirm (estimatedDeliveryDate + 5 days) */
  autoReleaseAt?: string | null;
  /** Set when the auto-release scheduler executed (idempotency) */
  autoReleaseExecutedAt?: string | null;
  /** Return request fields (Story 6.3) */
  returnRequestedAt?: string | null;
  returnReason?: string | null;
  returnPhotoUrls?: string[];
  returnStatus?: 'pending_seller_response' | 'accepted_by_seller' | 'rejected_by_seller' | 'platform_mediated' | null;
  returnSellerDeadline?: string | null;
  completedAt?: string | null;
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
  /** BidRoom platform fee deducted from seller payout (4% of item price, dollars) */
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
  /** True when transaction originated from a private room (48h payment window, non-payment enforcement) */
  isPrivateRoom?: boolean;
  /** Why this transaction was cancelled */
  cancellationReason?: 'non_payment' | 'seller_cancelled' | 'auto_cancelled_no_shipment' | 'other' | null;
  /** Original buyer ID when a second-chance bidder was assigned */
  originalBuyerId?: string | null;
  secondChanceAssignedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  role?: 'seller' | 'buyer';
  /** Payment method chosen by buyer */
  paymentMethod?: 'stripe' | 'in_person' | 'bank_transfer' | 'mbway' | null;
}

export interface TransactionsResponse {
  transactions: Transaction[];
}

export type DamageClaimStatus =
  | 'pending_review'
  | 'approved_refund'
  | 'packaging_rejected'
  | 'carrier_claim_filed'
  | 'resolved'
  | 'closed';

export interface DamageClaim {
  _id: string;
  transaction: string;
  buyer: string;
  seller: string;
  listing: { _id: string; title: string; slug: string; category: string } | null;
  shippingType: 'platform_label' | 'external_shipping';
  status: DamageClaimStatus;
  damagePhotoUrls: string[];
  packagingPhotoUrls: string[];
  description: string | null;
  packagingCompliant: boolean | null;
  carrierClaimReference: string | null;
  carrierClaimFiledAt: string | null;
  refundAmount: number | null;
  refundedAt: string | null;
  sellerCompensationAmount: number | null;
  sellerCompensatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
      paymentMethod?: 'in_person' | 'bank_transfer' | 'mbway';
      trackingNumber?: string;
      trackingCarrier?: string;
      estimatedDeliveryDays?: number;
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

  /** Upload return evidence (images only, max 30MB). */
  uploadReturnEvidence(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${this.uploadsUrl}/dispute-evidence`, formData);
  }

  /** Buyer: request a return within 7 days of delivery confirmation. */
  requestReturn(id: string, payload: { reason: string; photoUrls: string[] }): Observable<Transaction> {
    return this.http.post<Transaction>(`${this.apiUrl}/${id}/request-return`, payload);
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

  /** Seller: quick relist after non-payment (uses listing id, not transaction id). */
  relistListing(listingId: string): Observable<{ message: string; listing?: { slug: string; _id: string } }> {
    return this.http.post<{ message: string; listing?: { slug: string; _id: string } }>(
      `${API_CONFIG.getApiUrl()}/listings/${listingId}/relist`, {}
    );
  }

  // ── Damage Claims ──────────────────────────────────────────────────────────

  private damageClaimsUrl = `${API_CONFIG.getApiUrl()}/damage-claims`;

  /** Open a damage-in-transit claim (buyer only, within 48h of delivery). */
  openDamageClaim(payload: {
    transactionId: string;
    damagePhotoUrls: string[];
    packagingPhotoUrls: string[];
    description?: string;
  }): Observable<{ claim: DamageClaim }> {
    return this.http.post<{ claim: DamageClaim }>(this.damageClaimsUrl, payload);
  }

  /** Get the damage claim for a transaction (buyer or seller). */
  getDamageClaimByTransaction(transactionId: string): Observable<{ claim: DamageClaim }> {
    return this.http.get<{ claim: DamageClaim }>(`${this.damageClaimsUrl}/transaction/${transactionId}`);
  }

  /** Upload a damage evidence photo (reuses dispute-evidence endpoint). Returns blob URL. */
  uploadDamagePhoto(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${this.uploadsUrl}/dispute-evidence`, formData);
  }
}
