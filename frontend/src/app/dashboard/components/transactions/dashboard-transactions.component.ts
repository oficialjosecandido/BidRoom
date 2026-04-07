import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import Swal from 'sweetalert2';
import { TransactionsService, Transaction, TransactionStatus } from '../../../shared/services/transactions.service';
import { ReviewsService } from '../../../shared/services/reviews.service';
import { AirwallexService } from '../../../shared/services/airwallex.service';
import { ShippingService, ShippingRate, DeliveryAddress } from '../../../shared/services/shipping.service';

const successToast = Swal.mixin({
  toast: true,
  position: 'top-end',
  icon: 'success',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true
});

@Component({
  selector: 'app-dashboard-transactions',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, TranslateModule],
  templateUrl: './dashboard-transactions.component.html',
  styleUrls: ['./dashboard-transactions.component.scss']
})
export class DashboardTransactionsComponent implements OnInit {
  transactionsService = inject(TransactionsService);
  private reviewsService = inject(ReviewsService);
  private airwallexService = inject(AirwallexService);
  private shippingService = inject(ShippingService);
  private route = inject(ActivatedRoute);

  transactions: Transaction[] = [];
  isLoading = true;
  error: string | null = null;
  updatingId: string | null = null;
  /** Review modal */
  reviewModalTransaction: Transaction | null = null;
  reviewScore = 0;
  reviewDescription = '';
  reviewError: string | null = null;
  reviewSubmitting = false;
  /** Dispute modal (opens in-place on Transactions screen) */
  disputeModalTransaction: Transaction | null = null;
  disputeReason = '';
  disputeExplanation = '';
  disputeMediaUrls: string[] = [];
  disputeError: string | null = null;
  disputeSubmitting = false;
  disputeEvidenceUploading = false;
  showTrackingFormId: string | null = null;
  trackingNumber = '';
  trackingCarrier = '';
  /** Transaction ID currently initiating Airwallex payment */
  airwallexPayingTxId: string | null = null;
  airwallexPaymentError: string | null = null;
  /** Transaction ID for which the Airwallex card widget is open */
  airwallexWidgetTxId: string | null = null;
  airwallexClientSecret: string | null = null;
  /** Transaction ID for which buyer is confirming receipt (capture in progress) */
  confirmingReceiptTxId: string | null = null;
  /** Proof of delivery (seller): uploaded URL and file name per transaction. */
  deliveryProofUploadedUrlByTxId: Record<string, string> = {};
  deliveryProofFileNameByTxId: Record<string, string> = {};
  deliveryProofUploadingTxId: string | null = null;
  deliveryProofErrorByTxId: Record<string, string> = {};
  /** Transaction ID currently downloading invoice/receipt PDF */
  invoiceDownloadingTxId: string | null = null;
  /** Shipping rate flow state */
  shippingRatesTxId: string | null = null;      // txId for which rate panel is open
  shippingRates: ShippingRate[] = [];
  shippingRatesLoading = false;
  shippingRatesError: string | null = null;
  lockingRateTxId: string | null = null;
  /** Delivery address form used for shipping rate calculation */
  deliveryAddress: DeliveryAddress = { street1: '', city: '', state: '', postalCode: '', country: 'US' };

  ngOnInit(): void {
    this.loadTransactions();

    // Scroll to transaction when navigating with fragment (e.g. from review modal)
    this.route.fragment.subscribe(fragment => {
      if (fragment?.startsWith('transaction-')) {
        this.scrollToTransactionAfterLoad(fragment);
      }
    });

    // Handle return from Airwallex payment (intentId in query params)
    this.route.queryParams.subscribe(params => {
      const intentId = params['airwallex_intent'];
      const txId = params['transaction_id'];
      if (intentId === 'cancelled') {
        this.airwallexPaymentError = 'Payment was cancelled. You can try again anytime.';
      }
    });
  }

  loadTransactions(): void {
    this.isLoading = true;
    this.error = null;
    this.transactionsService.getMyTransactions().subscribe({
      next: (res) => {
        this.transactions = res.transactions || [];
        this.isLoading = false;
        this.scrollToTransactionFromFragment();
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Failed to load transactions';
        this.isLoading = false;
      }
    });
  }

  private scrollToTransactionAfterLoad(fragment: string): void {
    const scroll = () => {
      const el = document.getElementById(fragment);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    if (!this.isLoading && this.transactions.length > 0) {
      setTimeout(scroll, 100);
    }
  }

  private scrollToTransactionFromFragment(): void {
    const fragment = this.route.snapshot.fragment;
    if (fragment?.startsWith('transaction-')) {
      setTimeout(() => {
        const el = document.getElementById(fragment);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  }

  isBuyer(t: Transaction): boolean {
    return t.role === 'buyer';
  }

  isSeller(t: Transaction): boolean {
    return t.role === 'seller';
  }

  /** Effective overall status (transactionStatus preferred over legacy status) */
  getEffectiveStatus(t: Transaction): TransactionStatus {
    return t.transactionStatus ?? t.status ?? 'pending_payment';
  }

  /** Transaction is "Done" = completed; dispute is disabled when Done */
  isDone(t: Transaction): boolean {
    return this.getEffectiveStatus(t) === 'completed';
  }

  /** Both buyer and seller have left their reviews; required before marking as completed */
  hasBothReviewed(t: Transaction): boolean {
    return !!(t.buyerHasReviewedSeller && t.sellerHasReviewedBuyer);
  }

  /** Can mark as completed only when delivered AND both parties have reviewed */
  canMarkAsCompleted(t: Transaction): boolean {
    return (
      this.getEffectiveStatus(t) === 'delivered' &&
      this.hasBothReviewed(t)
    );
  }

  getStatusLabel(status: TransactionStatus): string {
    const labels: Record<TransactionStatus, string> = {
      pending_payment: 'Pending payment',
      awaiting_seller_acceptance: 'Awaiting seller confirmation',
      authorized: 'Payment held',
      paid: 'Paid',
      shipped: 'Shipped',
      delivered: 'Delivered',
      under_dispute: 'Under dispute',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    return labels[status] || status;
  }

  getBuyingStatusLabel(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (s === 'under_dispute') return 'Under Dispute';
    if (['delivered', 'completed'].includes(s) && !t.buyerHasReviewedSeller) return 'Pending Review';
    const map: Record<TransactionStatus, string> = {
      pending_payment: 'Pending Payment',
      awaiting_seller_acceptance: 'Payment sent',
      authorized: 'Payment Held',
      paid: 'Paid',
      shipped: 'Item Sent — Confirm Receipt',
      delivered: 'Received',
      under_dispute: 'Under Dispute',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    return map[s] || s;
  }

  getSellingStatusLabel(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (s === 'under_dispute') return 'Under Dispute';
    if (['delivered', 'completed'].includes(s) && !t.sellerHasReviewedBuyer) return 'Pending Review';
    const map: Record<TransactionStatus, string> = {
      pending_payment: 'Awaiting Payment',
      awaiting_seller_acceptance: 'Confirm payment',
      authorized: 'Payment Held — Ship Now',
      paid: 'Payment Received',
      shipped: 'Awaiting Buyer Confirmation',
      delivered: 'Payout Pending',
      under_dispute: 'Under Dispute',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    return map[s] || s;
  }

  getBuyingStatusClass(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (s === 'under_dispute') return 'status-dispute';
    if (['delivered', 'completed'].includes(s) && !t.buyerHasReviewedSeller) return 'status-review';
    const map: Record<TransactionStatus, string> = {
      pending_payment: 'status-pending',
      awaiting_seller_acceptance: 'status-paid',
      authorized: 'status-authorized',
      paid: 'status-paid',
      shipped: 'status-shipped',
      delivered: 'status-delivered',
      under_dispute: 'status-dispute',
      completed: 'status-completed',
      cancelled: 'status-cancelled'
    };
    return map[s] || '';
  }

  getSellingStatusClass(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (s === 'under_dispute') return 'status-dispute';
    if (['delivered', 'completed'].includes(s) && !t.sellerHasReviewedBuyer) return 'status-review';
    const map: Record<TransactionStatus, string> = {
      pending_payment: 'status-pending',
      awaiting_seller_acceptance: 'status-pending',
      authorized: 'status-authorized',
      paid: 'status-paid',
      shipped: 'status-shipped',
      delivered: 'status-shipped',
      under_dispute: 'status-dispute',
      completed: 'status-completed',
      cancelled: 'status-cancelled'
    };
    return map[s] || '';
  }

  getStatusClass(status: TransactionStatus): string {
    const classes: Record<TransactionStatus, string> = {
      pending_payment: 'status-pending',
      awaiting_seller_acceptance: 'status-pending',
      authorized: 'status-authorized',
      paid: 'status-paid',
      shipped: 'status-shipped',
      delivered: 'status-delivered',
      under_dispute: 'status-dispute',
      completed: 'status-completed',
      cancelled: 'status-cancelled'
    };
    return classes[status] || '';
  }

  /** Hours remaining before the 14-day pre-auth hold expires. Null if no hold or already expired. */
  getHoldHoursRemaining(t: Transaction): number | null {
    if (!t.intentExpiresAt) return null;
    const ms = new Date(t.intentExpiresAt).getTime() - Date.now();
    if (ms <= 0) return 0;
    return Math.round(ms / (60 * 60 * 1000));
  }

  /** True when the hold expiry is within 24 hours — highlight as urgent */
  isHoldExpiringSoon(t: Transaction): boolean {
    const h = this.getHoldHoursRemaining(t);
    return h !== null && h <= 24;
  }

  /**
   * Buyer confirms receipt ("Got the items").
   * Triggers Airwallex capture — funds move from hold → seller's account.
   * Escrow T+3 window begins; seller payout released after 3 days.
   */
  confirmReceipt(t: Transaction): void {
    if (this.confirmingReceiptTxId) return;
    if (t.role !== 'buyer') return;
    const s = this.getEffectiveStatus(t);
    if (!['authorized', 'shipped'].includes(s)) return;

    Swal.fire({
      icon: 'question',
      title: 'Confirm you received the item?',
      html: `By clicking <strong>Confirm</strong>, you release payment to the seller.<br><br>
             Only do this after you've physically received and inspected the item.
             Once confirmed, the transaction cannot be reversed without opening a dispute.`,
      showCancelButton: true,
      confirmButtonText: 'Yes, I got it',
      cancelButtonText: 'Not yet',
      confirmButtonColor: '#7A4F84',
      reverseButtons: true
    }).then(result => {
      if (!result.isConfirmed) return;
      this.confirmingReceiptTxId = t._id;
      this.transactionsService.capturePayment(t._id).subscribe({
        next: () => {
          this.confirmingReceiptTxId = null;
          this.loadTransactions();
          successToast.fire({ title: 'Receipt confirmed! Seller will be paid within 3 days.' });
        },
        error: (err) => {
          this.confirmingReceiptTxId = null;
          Swal.fire({
            icon: 'error',
            title: 'Could not confirm receipt',
            text: err?.error?.message || 'Please try again or contact support.',
            confirmButtonColor: '#7A4F84'
          });
        }
      });
    });
  }

  formatPrice(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  // ── Airwallex payment ─────────────────────────────────────────────────────────

  /** Open Airwallex card checkout for a pending_payment transaction */
  openAirwallexPayment(t: Transaction): void {
    if (this.airwallexPayingTxId || t.role !== 'buyer' || this.getEffectiveStatus(t) !== 'pending_payment') return;
    if (this.needsShippingRate(t)) {
      this.openShippingPanel(t);
      return;
    }
    this.airwallexPayingTxId = t._id;
    this.airwallexPaymentError = null;

    // Reuse existing intent if already on the transaction
    if (t.airwallexPaymentIntentId && t.airwallexClientSecret) {
      this.airwallexPayingTxId = null;
      this.airwallexWidgetTxId = t._id;
      this.airwallexClientSecret = t.airwallexClientSecret;
      return;
    }

    this.airwallexService.createPaymentIntent(t._id).subscribe({
      next: (res) => {
        this.airwallexPayingTxId = null;
        this.airwallexWidgetTxId = t._id;
        this.airwallexClientSecret = res.clientSecret;
      },
      error: (err) => {
        this.airwallexPayingTxId = null;
        const apiError = err?.error?.error;
        if (apiError === 'Seller not ready') {
          this.airwallexPaymentError = `Payment unavailable: the seller has not completed their payout account setup yet. Please try again later.`;
        } else {
          this.airwallexPaymentError = err?.error?.message || 'Failed to start payment. Please try again.';
        }
      }
    });
  }

  closeAirwallexWidget(): void {
    this.airwallexWidgetTxId = null;
    this.airwallexClientSecret = null;
  }

  /** Financial breakdown: BidRoom fee (2% of item price) */
  getBidRoomFee(t: Transaction): number {
    if (t.bidRoomFeeAmount != null) return t.bidRoomFeeAmount;
    return t.amount * 0.02;
  }

  /** Card processing fee row (optional; Airwallex flow may not expose a separate line item) */
  getStripeFee(_t: Transaction): number | null {
    return null;
  }

  canSellerAcceptPayment(t: Transaction): boolean {
    return this.isSeller(t) && this.getEffectiveStatus(t) === 'awaiting_seller_acceptance';
  }

  formatPaymentAcceptanceDeadline(t: Transaction): string {
    const d = t.paymentAcceptanceDeadline;
    if (!d) return '';
    return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }

  hasPaymentAcceptanceDeadlinePassed(t: Transaction): boolean {
    if (!t.paymentAcceptanceDeadline) return false;
    return new Date(t.paymentAcceptanceDeadline) < new Date();
  }

  acceptPayment(t: Transaction): void {
    if (this.updatingId || !this.isSeller(t) || this.getEffectiveStatus(t) !== 'awaiting_seller_acceptance') return;
    this.updatingId = t._id;
    this.transactionsService.updateTransaction(t._id, { status: 'accept_payment' }).subscribe({
      next: (updated) => {
        this.replaceTransaction(updated);
        this.updatingId = null;
      },
      error: () => (this.updatingId = null)
    });
  }

  /** Shipping amount: uses locked rate if available, falls back to flat-rate / free / null */
  getShippingAmount(t: Transaction): number | null {
    if (t.shippingAmount != null) return t.shippingAmount;
    const opt = t.listing?.shippingOption || 'flat-rate';
    if (opt === 'free' || opt === 'local-pickup') return 0;
    if (opt === 'flat-rate') return t.listing?.shippingCost ?? 0;
    return null; // calculated but not yet locked
  }

  /** True when buyer needs to select a shipping rate before paying */
  needsShippingRate(t: Transaction): boolean {
    return (
      this.isBuyer(t) &&
      t.listing?.shippingOption === 'calculated' &&
      t.shippingAmount == null &&
      this.getEffectiveStatus(t) === 'pending_payment'
    );
  }

  /** Toggle the shipping rate panel for a transaction */
  openShippingPanel(t: Transaction): void {
    this.shippingRatesTxId = t._id;
    this.shippingRates = [];
    this.shippingRatesError = null;
    // Pre-fill with previously saved address if available
    if (t.buyerDeliveryAddress?.street1) {
      this.deliveryAddress = {
        street1: t.buyerDeliveryAddress.street1 || '',
        city: t.buyerDeliveryAddress.city || '',
        state: t.buyerDeliveryAddress.state || '',
        postalCode: t.buyerDeliveryAddress.postalCode || '',
        country: t.buyerDeliveryAddress.country || 'US'
      };
    } else {
      this.deliveryAddress = { street1: '', city: '', state: '', postalCode: '', country: 'US' };
    }
  }

  closeShippingPanel(): void {
    this.shippingRatesTxId = null;
    this.shippingRates = [];
    this.shippingRatesError = null;
  }

  /** Fetch carrier rates from the backend */
  fetchShippingRates(t: Transaction): void {
    const addr = this.deliveryAddress;
    if (!addr.street1 || !addr.city || !addr.state || !addr.postalCode) {
      this.shippingRatesError = 'Please fill in all address fields (street, city, state, postal code).';
      return;
    }
    this.shippingRatesLoading = true;
    this.shippingRatesError = null;
    this.shippingRates = [];

    this.shippingService.calculateRates(t._id, addr).subscribe({
      next: (res) => {
        this.shippingRates = res.rates;
        this.shippingRatesLoading = false;
        if (res.rates.length === 0) {
          this.shippingRatesError = 'Shipping cannot be calculated for this delivery address. Please update shipping details or try again later.';
        }
      },
      error: (err) => {
        this.shippingRatesLoading = false;
        this.shippingRatesError = err?.error?.message || 'Shipping cannot be calculated for this delivery address. Please update shipping details or try again later.';
      }
    });
  }

  /** Lock the selected rate and update the local transaction */
  selectAndLockRate(t: Transaction, rate: ShippingRate): void {
    if (this.lockingRateTxId) return;
    this.lockingRateTxId = t._id;
    this.shippingRatesError = null;

    this.shippingService.lockRate(t._id, rate, this.deliveryAddress).subscribe({
      next: (res) => {
        this.lockingRateTxId = null;
        this.shippingRatesTxId = null;
        // Update the local transaction with locked shipping data
        this.replaceTransaction({
          ...t,
          shippingAmount: res.shippingAmount,
          shippingCarrier: res.carrier,
          shippingService: res.service,
          shippingDeliveryDays: res.deliveryDays,
          buyerDeliveryAddress: { ...this.deliveryAddress }
        });
      },
      error: (err) => {
        this.lockingRateTxId = null;
        this.shippingRatesError = err?.error?.message || 'Failed to lock shipping rate. Please try again.';
      }
    });
  }

  formatShippingRate(rate: ShippingRate): string {
    const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(rate.rate);
    const days = rate.deliveryDays ? ` · Est. ${rate.deliveryDays} days` : '';
    return `${rate.carrier} ${rate.service} — ${price}${days}`;
  }

  /** Seller net payout after BidRoom fee */
  getSellerNet(t: Transaction): number {
    if (t.sellerPayoutAmount != null) return t.sellerPayoutAmount;
    return t.amount - this.getBidRoomFee(t);
  }

  /** Buyer total charged (amount + BidRoom fee + shipping) */
  getBuyerTotal(t: Transaction): number | null {
    if (t.buyerTotalPaid != null) return t.buyerTotalPaid;
    const bidRoomFee = this.getBidRoomFee(t);
    const shipping = this.getShippingAmount(t);
    return shipping !== null ? t.amount + bidRoomFee + shipping : null;
  }

  /** Auction type label: Best Offer | Highest-Bid Auction (Private Room) | Highest-Bid Auction */
  getAuctionTypeLabel(t: Transaction): string {
    const fmt = t.listing?.auctionFormat;
    if (fmt === 'best-offer') return 'Best Offer';
    if (t.listing?.allowPrivateRoom) return 'Highest-Bid Auction (Private Room)';
    return 'Highest-Bid Auction';
  }

  /** Label for the sale price row, context-aware to auction type */
  getSalePriceLabel(t: Transaction): string {
    return t.listing?.auctionFormat === 'best-offer' ? 'Accepted offer price' : 'Final auction price';
  }

  /** Commission rate as a formatted percentage string */
  getCommissionRateLabel(t: Transaction): string {
    const rate = t.listing?.commissionRate ?? 0.005;
    return (rate * 100).toFixed(1) + '%';
  }

  getListingImage(t: Transaction): string {
    const img = t.listing?.images?.[0];
    return img || 'https://via.placeholder.com/400x300?text=No+Image';
  }

  getListingUrl(t: Transaction): string {
    const slug = t.listing?.slug;
    return slug ? `/listing/${slug}` : '#';
  }

  formatPaymentDeadline(t: Transaction): string {
    const d = t.paymentDeadline;
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }

  hasPaymentDeadlinePassed(t: Transaction): boolean {
    if (!t.paymentDeadline) return false;
    return new Date(t.paymentDeadline) < new Date();
  }

  markAsDelivered(t: Transaction): void {
    if (this.updatingId || t.role !== 'buyer' || this.getEffectiveStatus(t) !== 'shipped') return;
    this.updatingId = t._id;
    this.transactionsService.updateTransaction(t._id, { status: 'delivered' }).subscribe({
      next: (updated) => {
        this.replaceTransaction(updated);
        this.updatingId = null;
      },
      error: () => (this.updatingId = null)
    });
  }

  markAsCompleted(t: Transaction): void {
    if (this.updatingId || t.role !== 'buyer' || !['paid', 'shipped', 'delivered'].includes(this.getEffectiveStatus(t))) return;
    this.updatingId = t._id;
    this.transactionsService.updateTransaction(t._id, { status: 'completed' }).subscribe({
      next: (updated) => {
        this.replaceTransaction(updated);
        this.updatingId = null;
      },
      error: () => (this.updatingId = null)
    });
  }

  toggleTrackingForm(t: Transaction): void {
    if (this.showTrackingFormId === t._id) {
      this.showTrackingFormId = null;
      this.trackingNumber = '';
      this.trackingCarrier = '';
    } else {
      this.showTrackingFormId = t._id;
      this.trackingNumber = t.trackingNumber || '';
      this.trackingCarrier = t.trackingCarrier || '';
    }
  }

  triggerDeliveryProofUpload(t: Transaction, input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  hasDeliveryProofUploaded(t: Transaction): boolean {
    return !!this.deliveryProofUploadedUrlByTxId[t._id];
  }

  getDeliveryProofUploadButtonLabel(t: Transaction): string {
    if (this.deliveryProofUploadingTxId === t._id) return 'Uploading…';
    if (this.deliveryProofUploadedUrlByTxId[t._id]) return 'Proof uploaded';
    return 'Upload proof of delivery';
  }

  getDeliveryProofFileName(t: Transaction): string {
    return this.deliveryProofFileNameByTxId[t._id] || '';
  }

  getDeliveryProofUploadedUrl(t: Transaction): string | null {
    return this.deliveryProofUploadedUrlByTxId[t._id] || null;
  }

  removeDeliveryProof(t: Transaction): void {
    delete this.deliveryProofUploadedUrlByTxId[t._id];
    delete this.deliveryProofFileNameByTxId[t._id];
    delete this.deliveryProofErrorByTxId[t._id];
  }

  getDeliveryProofUploadError(t: Transaction): string | null {
    return this.deliveryProofErrorByTxId[t._id] || null;
  }

  onDeliveryProofFileSelected(t: Transaction, input: HTMLInputElement): void {
    delete this.deliveryProofErrorByTxId[t._id];
    const file = input.files?.[0];
    if (!file) return;
    const maxSize = this.transactionsService.proofOfPaymentMaxSize;
    if (file.size > maxSize) {
      this.deliveryProofErrorByTxId[t._id] = `File must be 30MB or less (${(file.size / 1024 / 1024).toFixed(1)}MB selected).`;
      input.value = '';
      return;
    }
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowed.includes(file.type)) {
      this.deliveryProofErrorByTxId[t._id] = 'Only PDF, JPG and PNG files are allowed.';
      input.value = '';
      return;
    }
    this.deliveryProofUploadingTxId = t._id;
    this.transactionsService.uploadProofOfDelivery(file).subscribe({
      next: (res) => {
        this.deliveryProofUploadedUrlByTxId[t._id] = res.url;
        this.deliveryProofFileNameByTxId[t._id] = file.name;
        this.deliveryProofUploadingTxId = null;
        delete this.deliveryProofErrorByTxId[t._id];
        input.value = '';
      },
      error: (err) => {
        this.deliveryProofErrorByTxId[t._id] = err.error?.message || 'Upload failed. Try again.';
        this.deliveryProofUploadingTxId = null;
        input.value = '';
      }
    });
  }

  submitShipped(t: Transaction): void {
    if (this.updatingId || t.role !== 'seller' || this.getEffectiveStatus(t) !== 'paid') return;
    const proofUrl = this.deliveryProofUploadedUrlByTxId[t._id];
    if (!proofUrl) return;
    this.updatingId = t._id;
    this.transactionsService
      .updateTransaction(t._id, {
        status: 'shipped',
        trackingNumber: this.trackingNumber || undefined,
        trackingCarrier: this.trackingCarrier || undefined,
        sellerProofOfDeliveryUrl: proofUrl
      })
      .subscribe({
        next: (updated) => {
          this.replaceTransaction(updated);
          this.updatingId = null;
          this.showTrackingFormId = null;
          this.trackingNumber = '';
          this.trackingCarrier = '';
          delete this.deliveryProofUploadedUrlByTxId[t._id];
          delete this.deliveryProofFileNameByTxId[t._id];
          delete this.deliveryProofErrorByTxId[t._id];
          successToast.fire({ title: 'Delivery information sent' });
        },
        error: () => (this.updatingId = null)
      });
  }

  /** Download invoice (seller) or receipt (buyer) PDF for completed transactions */
  downloadInvoice(t: Transaction): void {
    if (!t.role || this.invoiceDownloadingTxId) return;
    this.invoiceDownloadingTxId = t._id;
    this.transactionsService.getInvoice(t._id, t.role).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = t.role === 'seller' ? `invoice-${t._id}.pdf` : `receipt-${t._id}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        this.invoiceDownloadingTxId = null;
      },
      error: () => {
        this.invoiceDownloadingTxId = null;
      }
    });
  }

  /** Whether the current user can leave a review for this transaction (delivered/completed + hasn't reviewed) */
  canLeaveReview(t: Transaction): boolean {
    const s = this.getEffectiveStatus(t);
    if (!['delivered', 'completed'].includes(s)) return false;
    if (this.isBuyer(t) && !t.buyerHasReviewedSeller) return true;
    if (this.isSeller(t) && !t.sellerHasReviewedBuyer) return true;
    return false;
  }

  getReviewOtherPartyName(t: Transaction): string {
    const other = this.isBuyer(t) ? t.seller : t.buyer;
    if (!other) return 'Other party';
    return `${(other as { firstName?: string }).firstName || ''} ${(other as { lastName?: string }).lastName || ''}`.trim() || (this.isBuyer(t) ? 'Seller' : 'Buyer');
  }

  /** Role for API: as_buyer = I review them as buyer; as_seller = I review them as seller */
  getReviewRole(t: Transaction): 'as_buyer' | 'as_seller' {
    return this.isBuyer(t) ? 'as_seller' : 'as_buyer';
  }

  getReviewOtherPartyId(t: Transaction): string {
    const other = this.isBuyer(t) ? t.seller : t.buyer;
    const o = other as { _id?: string };
    return o?._id?.toString() || String(other);
  }

  openReviewModal(t: Transaction): void {
    this.reviewModalTransaction = t;
    this.reviewScore = 0;
    this.reviewDescription = '';
    this.reviewError = null;
  }

  closeReviewModal(): void {
    this.reviewModalTransaction = null;
    this.reviewScore = 0;
    this.reviewDescription = '';
    this.reviewError = null;
  }

  setReviewScore(n: number): void {
    this.reviewScore = n;
  }

  /** Visual tier for 1–10 score buttons (matches review modal styling). */
  scoreTier(i: number): 'low' | 'mid' | 'high' {
    if (i <= 3) return 'low';
    if (i <= 7) return 'mid';
    return 'high';
  }

  submitReview(): void {
    const t = this.reviewModalTransaction;
    if (!t || this.reviewScore < 1 || this.reviewScore > 10) {
      this.reviewError = 'Please select a score from 1 to 10.';
      return;
    }
    const listingId = (t.listing && (t.listing as { _id?: string })._id ? (t.listing as { _id?: string })._id : t.listing)?.toString();
    if (!listingId) {
      this.reviewError = 'Transaction has no listing.';
      return;
    }
    this.reviewSubmitting = true;
    this.reviewError = null;
    this.reviewsService
      .createReview({
        listingId,
        toUserId: this.getReviewOtherPartyId(t),
        role: this.getReviewRole(t),
        score: this.reviewScore,
        description: this.reviewDescription.trim() || undefined
      })
      .subscribe({
        next: () => {
          this.reviewSubmitting = false;
          this.closeReviewModal();
          this.loadTransactions();
          successToast.fire({ title: 'Review submitted' });
        },
        error: (err) => {
          this.reviewSubmitting = false;
          this.reviewError = err?.error?.message || 'Failed to submit review.';
        }
      });
  }

  /** Open dispute modal (buyer only, status must be shipped) */
  openDisputeModal(t: Transaction): void {
    if (!this.isBuyer(t) || this.getEffectiveStatus(t) !== 'shipped' || t.disputeOpen) return;
    this.disputeModalTransaction = t;
    this.disputeReason = '';
    this.disputeExplanation = '';
    this.disputeMediaUrls = [];
    this.disputeError = null;
  }

  closeDisputeModal(): void {
    this.disputeModalTransaction = null;
    this.disputeReason = '';
    this.disputeExplanation = '';
    this.disputeMediaUrls = [];
    this.disputeError = null;
  }

  canSubmitDispute(): boolean {
    return !!(
      this.disputeReason &&
      this.disputeExplanation.trim().length >= 20 &&
      this.disputeMediaUrls.length >= 1
    );
  }

  onDisputeEvidenceSelected(input: HTMLInputElement): void {
    const files = input.files;
    if (!files || files.length === 0) return;
    this.disputeError = null;
    const maxSize = this.transactionsService.proofOfPaymentMaxSize;
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm'];
    const toUpload: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > maxSize) {
        this.disputeError = `File ${f.name} is too large (max 30MB).`;
        input.value = '';
        return;
      }
      if (!allowed.includes(f.type)) {
        this.disputeError = `File ${f.name}: only images, PDF, or video (MP4/WebM) allowed.`;
        input.value = '';
        return;
      }
      toUpload.push(f);
    }
    if (toUpload.length + this.disputeMediaUrls.length > 10) {
      this.disputeError = 'Maximum 10 files allowed.';
      input.value = '';
      return;
    }
    this.disputeEvidenceUploading = true;
    let done = 0;
    const total = toUpload.length;
    toUpload.forEach((file) => {
      this.transactionsService.uploadDisputeEvidence(file).subscribe({
        next: (res) => {
          this.disputeMediaUrls = [...this.disputeMediaUrls, res.url];
          done++;
          if (done === total) this.disputeEvidenceUploading = false;
        },
        error: () => {
          this.disputeError = 'Upload failed.';
          this.disputeEvidenceUploading = false;
        }
      });
    });
    input.value = '';
  }

  submitDispute(): void {
    const t = this.disputeModalTransaction;
    if (!t || this.disputeSubmitting || !this.canSubmitDispute()) return;
    this.disputeSubmitting = true;
    this.disputeError = null;
    this.transactionsService
      .openDispute(t._id, {
        reason: this.disputeReason,
        explanation: this.disputeExplanation.trim(),
        mediaUrls: this.disputeMediaUrls
      })
      .subscribe({
        next: () => {
          this.disputeSubmitting = false;
          this.closeDisputeModal();
          successToast.fire({ title: 'Dispute submitted' });
          this.loadTransactions();
        },
        error: (err) => {
          this.disputeError = err?.error?.message || 'Failed to submit dispute.';
          this.disputeSubmitting = false;
        }
      });
  }

  getDisputeReasonLabel(reason: string): string {
    const labels: Record<string, string> = {
      item_not_as_described: 'Item not as described',
      damaged_in_transit: 'Damaged in transit',
      missing_parts: 'Missing parts',
      counterfeit: 'Counterfeit',
      other: 'Other'
    };
    return labels[reason] || reason;
  }

  private replaceTransaction(updated: Transaction): void {
    const idx = this.transactions.findIndex((x) => x._id === updated._id);
    if (idx !== -1) {
      const role = this.transactions[idx].role;
      this.transactions[idx] = {
        ...updated,
        role,
        transactionStatus: updated.transactionStatus ?? updated.status,
        paymentStatus: updated.paymentStatus,
        sendingStatus: updated.sendingStatus
      };
    }
  }
}
