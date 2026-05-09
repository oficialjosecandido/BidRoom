import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import Swal from 'sweetalert2';
import { TransactionsService, Transaction, TransactionStatus, DamageClaim } from '../../../shared/services/transactions.service';
import { ReviewsService } from '../../../shared/services/reviews.service';
import { StripeConnectService } from '../../../shared/services/stripe-connect.service';
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
  private stripeConnect = inject(StripeConnectService);
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
  estimatedDeliveryDays: number | null = null;
  /** Return request modal */
  returnModalTransaction: Transaction | null = null;
  returnReason = '';
  returnPhotoUrls: string[] = [];
  returnError: string | null = null;
  returnSubmitting = false;
  returnEvidenceUploading = false;
  /** Transaction ID currently redirecting to Stripe Checkout */
  stripePayingTxId: string | null = null;
  /** Transaction ID currently confirming Stripe payment on return */
  stripeConfirmingTxId: string | null = null;
  stripePaymentError: string | null = null;
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
  /** Transaction ID for which a "Remind seller to ship" request is in flight (loading state). */
  remindSellerShipTxId: string | null = null;
  /** Damage claim modal */
  damageClaimTransaction: Transaction | null = null;
  damagePhotoUrls: string[] = [];
  packagingPhotoUrls: string[] = [];
  damageDescription = '';
  damageClaimError: string | null = null;
  damageClaimSubmitting = false;
  damagePhotoUploading = false;
  packagingPhotoUploading = false;
  /** Existing claims keyed by transactionId (loaded lazily on reveal) */
  existingClaimsByTxId: Record<string, DamageClaim | null> = {};

  /** Claim window: 48 hours in ms */
  private readonly CLAIM_WINDOW_MS = 48 * 60 * 60 * 1000;

  ngOnInit(): void {
    this.loadTransactions();

    // Scroll to transaction when navigating with fragment (e.g. from review modal)
    this.route.fragment.subscribe(fragment => {
      if (fragment?.startsWith('transaction-')) {
        this.scrollToTransactionAfterLoad(fragment);
      }
    });

    // Handle return from Stripe Checkout
    this.route.queryParams.subscribe(params => {
      const payment = params['stripe_payment'];
      const sessionId = params['session_id'];
      const transactionId = params['transaction_id'];

      if (payment === 'success' && sessionId && transactionId) {
        this.confirmStripePayment(sessionId, transactionId);
      } else if (payment === 'cancelled') {
        this.stripePaymentError = 'Payment was cancelled. You can try again anytime.';
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

  /** Both buyer and seller have left their reviews */
  hasBothReviewed(t: Transaction): boolean {
    return !!(t.buyerHasReviewedSeller && t.sellerHasReviewedBuyer);
  }

  /** Buyer can mark as completed once item flow reached paid/shipped/delivered */
  canMarkAsCompleted(t: Transaction): boolean {
    return ['paid', 'shipped', 'delivered'].includes(this.getEffectiveStatus(t));
  }

  getStatusLabel(status: TransactionStatus): string {
    const labels: Record<TransactionStatus, string> = {
      pending_payment: 'Pending payment',
      awaiting_seller_acceptance: 'Awaiting seller acceptance',
      paid: 'Paid',
      shipped: 'Shipped',
      delivered: 'Delivered',
      under_dispute: 'Under dispute',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    return labels[status] || status;
  }

  /** Buying status: Pending Payment | Payment Submitted | Paid | Received | Pending Review | Under Dispute | Completed */
  getBuyingStatusLabel(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (s === 'under_dispute') return 'Under Dispute';
    if (s === 'completed' && !t.buyerHasReviewedSeller && this.isWithinReviewWindow(t)) {
      return 'Pending Review';
    }
    const map: Record<TransactionStatus, string> = {
      pending_payment: 'Pending Payment',
      awaiting_seller_acceptance: 'Payment Submitted',
      paid: 'Paid',
      shipped: 'Paid',
      delivered: 'Received',
      under_dispute: 'Under Dispute',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    return map[s] || s;
  }

  /** Selling status: Pending Delivery | Pending Acceptance | Payment Received | Sent | Pending Review | Under Dispute | Completed */
  getSellingStatusLabel(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (s === 'under_dispute') return 'Under Dispute';
    if (s === 'completed' && !t.sellerHasReviewedBuyer && this.isWithinReviewWindow(t)) {
      return 'Pending Review';
    }
    const map: Record<TransactionStatus, string> = {
      pending_payment: 'Pending Delivery',
      awaiting_seller_acceptance: 'Pending Acceptance',
      paid: 'Payment Received',
      shipped: 'Sent',
      delivered: 'Sent',
      under_dispute: 'Under Dispute',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    return map[s] || s;
  }

  getBuyingStatusClass(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (s === 'under_dispute') return 'status-dispute';
    if (s === 'completed' && !t.buyerHasReviewedSeller && this.isWithinReviewWindow(t)) {
      return 'status-review';
    }
    const map: Record<TransactionStatus, string> = {
      pending_payment: 'status-pending',
      awaiting_seller_acceptance: 'status-paid',
      paid: 'status-paid',
      shipped: 'status-paid',
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
    if (s === 'completed' && !t.sellerHasReviewedBuyer && this.isWithinReviewWindow(t)) {
      return 'status-review';
    }
    const map: Record<TransactionStatus, string> = {
      pending_payment: 'status-pending',
      awaiting_seller_acceptance: 'status-pending',
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
      paid: 'status-paid',
      shipped: 'status-shipped',
      delivered: 'status-delivered',
      under_dispute: 'status-dispute',
      completed: 'status-completed',
      cancelled: 'status-cancelled'
    };
    return classes[status] || '';
  }

  /** Seller can accept payment when buyer has submitted proof (5-day window) */
  canSellerAcceptPayment(t: Transaction): boolean {
    return this.getEffectiveStatus(t) === 'awaiting_seller_acceptance';
  }

  hasPaymentAcceptanceDeadlinePassed(t: Transaction): boolean {
    const d = t.paymentAcceptanceDeadline;
    if (!d) return false;
    return new Date(d) < new Date();
  }

  formatPaymentAcceptanceDeadline(t: Transaction): string {
    const d = t.paymentAcceptanceDeadline;
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  formatPrice(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  /** Pay via Stripe: create checkout session and redirect */
  payWithStripe(t: Transaction): void {
    if (this.stripePayingTxId || t.role !== 'buyer' || this.getEffectiveStatus(t) !== 'pending_payment') return;
    if (this.needsShippingRate(t)) {
      this.openShippingPanel(t);
      return;
    }
    this.stripePayingTxId = t._id;
    this.stripePaymentError = null;
    this.stripeConnect.createCheckoutSession(t._id).subscribe({
      next: (res) => {
        window.location.href = res.url;
      },
      error: (err) => {
        this.stripePayingTxId = null;
        const apiError = err?.error?.error;
        if (apiError === 'Seller not ready') {
          this.stripePaymentError = `Payment unavailable: the seller has not connected their Stripe account yet. ` +
            `Please contact the seller (${t.seller?.firstName} ${t.seller?.lastName}) or wait for them to complete their payment setup.`;
        } else {
          this.stripePaymentError = err?.error?.message || 'Failed to start payment. Please try again.';
        }
      }
    });
  }

  confirmStripePayment(sessionId: string, transactionId: string): void {
    this.stripeConfirmingTxId = transactionId;
    this.stripeConnect.confirmPayment(sessionId, transactionId).subscribe({
      next: (updated) => {
        this.stripeConfirmingTxId = null;
        this.replaceTransaction({ ...updated, role: 'buyer' });
        successToast.fire({ title: 'Payment confirmed! The seller has been notified.' });
      },
      error: (err) => {
        this.stripeConfirmingTxId = null;
        this.stripePaymentError = err?.error?.message || 'Could not confirm payment. Please contact support if funds were charged.';
      }
    });
  }

  /** Financial breakdown: BidRoom fee (4% of item price, charged to seller) */
  getBidRoomFee(t: Transaction): number {
    if (t.bidRoomFeeAmount != null) return t.bidRoomFeeAmount;
    return t.amount * 0.04;
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

  /** Stripe processing fee (stored after payment; null if not yet paid) */
  getStripeFee(t: Transaction): number | null {
    return t.stripeFeeAmount ?? null;
  }

  /** Seller net payout */
  getSellerNet(t: Transaction): number {
    if (t.sellerPayoutAmount != null) return t.sellerPayoutAmount;
    const stripeFee = this.getStripeFee(t) ?? 0;
    return t.amount - this.getBidRoomFee(t) - stripeFee;
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

  /** Format the auto-cancellation date for display in the cancellation notice. */
  formatAutoCancelledAt(t: Transaction): string {
    if (!t.shippingAutoCancelledAt) return '';
    return new Date(t.shippingAutoCancelledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /**
   * Format the ship-by deadline for display.
   * Prefers shipByBusinessDeadline (5 business-day); falls back to legacy handlingDeadline.
   */
  formatShipByDeadline(t: Transaction): string {
    const raw = t.shipByBusinessDeadline || t.handlingDeadline;
    if (!raw) return '';
    return new Date(raw).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /**
   * Buyer-facing shipping status label.
   * - "Not shipped" while awaiting seller acceptance / paid
   * - "Shipped — [carrier] [tracking]" once marked shipped
   */
  buyerShippingStatusLine(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (s === 'shipped' || s === 'delivered' || s === 'completed') {
      if (t.trackingNumber) {
        const c = t.trackingCarrier ? `${t.trackingCarrier} ` : '';
        return `Shipped — ${c}${t.trackingNumber}`.trim();
      }
      return 'Shipped';
    }
    if (['awaiting_seller_acceptance', 'paid'].includes(s)) {
      return 'Not shipped';
    }
    return '—';
  }

  /** Whether the buyer has already used the "Remind seller" action within the last 24 hours. */
  isRemindSellerOnCooldown(t: Transaction): boolean {
    if (!t.buyerRemindSellerShipAt) return false;
    return Date.now() - new Date(t.buyerRemindSellerShipAt).getTime() < 24 * 60 * 60 * 1000;
  }

  /** True when the buyer is allowed to send a shipping reminder (correct role + status + not on cooldown). */
  canRemindSellerToShip(t: Transaction): boolean {
    if (!this.isBuyer(t)) return false;
    if (!['awaiting_seller_acceptance', 'paid'].includes(this.getEffectiveStatus(t))) return false;
    if (this.isRemindSellerOnCooldown(t)) return false;
    return true;
  }

  /**
   * Send a "Remind seller to ship" request. Updates the local transaction
   * on success, shows a toast, or displays the 24-hour cooldown message on 429.
   */
  remindSellerToShip(t: Transaction): void {
    if (!this.canRemindSellerToShip(t) || this.remindSellerShipTxId) return;
    this.remindSellerShipTxId = t._id;
    this.transactionsService.remindSellerToShip(t._id).subscribe({
      next: (updated) => {
        this.remindSellerShipTxId = null;
        this.replaceTransaction(updated);
        successToast.fire({ title: 'Reminder sent to the seller' });
      },
      error: (err) => {
        this.remindSellerShipTxId = null;
        const msg =
          err?.status === 429
            ? 'You can send another reminder after 24 hours.'
            : err?.error?.message || 'Could not send reminder.';
        Swal.fire({ icon: 'info', title: 'Reminder', text: msg, confirmButtonColor: '#7A4F84' });
      }
    });
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
      this.estimatedDeliveryDays = null;
    } else {
      this.showTrackingFormId = t._id;
      this.trackingNumber = t.trackingNumber || '';
      this.trackingCarrier = t.trackingCarrier || '';
      this.estimatedDeliveryDays = t.shippingDeliveryDays ?? null;
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

  acceptPayment(t: Transaction): void {
    if (this.updatingId || t.role !== 'seller' || this.getEffectiveStatus(t) !== 'awaiting_seller_acceptance') return;
    this.updatingId = t._id;
    this.transactionsService
      .updateTransaction(t._id, { status: 'accept_payment' })
      .subscribe({
        next: (updated) => {
          this.replaceTransaction(updated);
          this.updatingId = null;
        },
        error: () => (this.updatingId = null)
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
        estimatedDeliveryDays: this.estimatedDeliveryDays ?? undefined,
        sellerProofOfDeliveryUrl: proofUrl
      })
      .subscribe({
        next: (updated) => {
          this.replaceTransaction(updated);
          this.updatingId = null;
          this.showTrackingFormId = null;
          this.trackingNumber = '';
          this.trackingCarrier = '';
          this.estimatedDeliveryDays = null;
          delete this.deliveryProofUploadedUrlByTxId[t._id];
          delete this.deliveryProofFileNameByTxId[t._id];
          delete this.deliveryProofErrorByTxId[t._id];
          successToast.fire({ title: 'Delivery information sent' });
        },
        error: () => (this.updatingId = null)
      });
  }

  /** Format estimatedDeliveryDate for display */
  formatEstimatedDelivery(t: Transaction): string {
    if (!t.estimatedDeliveryDate) return '';
    return new Date(t.estimatedDeliveryDate).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  /** True if today is past the estimated delivery date (buyer should confirm) */
  isEstimatedDeliveryPassed(t: Transaction): boolean {
    if (!t.estimatedDeliveryDate) return false;
    return new Date(t.estimatedDeliveryDate) < new Date();
  }

  /** Format auto-release date for the buyer countdown notice */
  formatAutoReleaseDate(t: Transaction): string {
    if (!t.autoReleaseAt) return '';
    return new Date(t.autoReleaseAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  /** Days remaining before auto-release (negative = overdue) */
  daysUntilAutoRelease(t: Transaction): number | null {
    if (!t.autoReleaseAt) return null;
    const diff = new Date(t.autoReleaseAt).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /** Whether buyer can still request a return (delivered + within 7 days) */
  canRequestReturn(t: Transaction): boolean {
    if (!this.isBuyer(t)) return false;
    if (this.getEffectiveStatus(t) !== 'delivered') return false;
    if (t.returnRequestedAt) return false; // already submitted
    if (!t.deliveredAt) return true; // no deliveredAt recorded — allow
    const deadline = new Date(t.deliveredAt);
    deadline.setDate(deadline.getDate() + 7);
    return new Date() <= deadline;
  }

  /** Days remaining in return window */
  returnWindowDaysLeft(t: Transaction): number {
    if (!t.deliveredAt) return 7;
    const deadline = new Date(t.deliveredAt);
    deadline.setDate(deadline.getDate() + 7);
    return Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }

  openReturnModal(t: Transaction): void {
    if (!this.canRequestReturn(t)) return;
    this.returnModalTransaction = t;
    this.returnReason = '';
    this.returnPhotoUrls = [];
    this.returnError = null;
  }

  /** Format remaining time until payment deadline as "XXh XXm" or "expired" */
  paymentDeadlineCountdown(t: Transaction): string {
    if (!t.paymentDeadline) return '';
    const diff = new Date(t.paymentDeadline).getTime() - Date.now();
    if (diff <= 0) return 'transactions.paymentExpired';
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }

  /** Whether the private-room payment countdown should be shown (buyer, pending, isPrivateRoom) */
  showPrivateRoomCountdown(t: Transaction): boolean {
    return !!(
      this.isBuyer(t) &&
      t.isPrivateRoom &&
      this.getEffectiveStatus(t) === 'pending_payment' &&
      t.paymentDeadline
    );
  }

  /** True when deadline has passed or less than 1 hour remains */
  isPaymentDeadlineUrgent(t: Transaction): boolean {
    if (!t.paymentDeadline) return false;
    return new Date(t.paymentDeadline).getTime() - Date.now() < 3600000;
  }

  /** True if buyer received a second-chance offer (originally someone else was the winner) */
  isSecondChanceBuyer(t: Transaction): boolean {
    return !!(t.isPrivateRoom && t.secondChanceAssignedAt);
  }

  relistItem(t: Transaction): void {
    if (!t.listing?.slug) return;
    const listingId = t.listing._id;
    this.transactionsService.relistListing(listingId).subscribe({
      next: () => {
        successToast.fire({ title: 'Item relisted for 7 days!' });
        this.loadTransactions();
      },
      error: (err) => {
        Swal.fire({ icon: 'error', title: 'Relist failed', text: err?.error?.message || 'Could not relist the item.' });
      }
    });
  }

  /** Whether the seller can relist (listing ended due to non_payment_no_second_bidder) */
  canRelist(t: Transaction): boolean {
    if (!this.isSeller(t)) return false;
    if (this.getEffectiveStatus(t) !== 'cancelled') return false;
    return t.cancellationReason === 'non_payment';
  }

  /** Whether buyer can open a damage claim (delivered + within 48h + no existing claim) */
  canOpenDamageClaim(t: Transaction): boolean {
    if (!this.isBuyer(t)) return false;
    if (this.getEffectiveStatus(t) !== 'delivered') return false;
    if (!t.deliveredAt) return false;
    const elapsed = Date.now() - new Date(t.deliveredAt).getTime();
    if (elapsed > this.CLAIM_WINDOW_MS) return false;
    // Hide if we already know a claim exists
    if (this.existingClaimsByTxId[t._id] !== undefined) return false;
    return true;
  }

  /** Hours remaining in the 48h damage claim window */
  damageClaimHoursLeft(t: Transaction): number {
    if (!t.deliveredAt) return 0;
    const elapsed = Date.now() - new Date(t.deliveredAt).getTime();
    return Math.max(0, Math.ceil((this.CLAIM_WINDOW_MS - elapsed) / 3600000));
  }

  openDamageClaimModal(t: Transaction): void {
    if (!this.canOpenDamageClaim(t)) return;
    this.damageClaimTransaction = t;
    this.damagePhotoUrls = [];
    this.packagingPhotoUrls = [];
    this.damageDescription = '';
    this.damageClaimError = null;
  }

  closeDamageClaimModal(): void {
    this.damageClaimTransaction = null;
  }

  async uploadDamagePhoto(event: Event, type: 'damage' | 'packaging'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    if (type === 'damage') this.damagePhotoUploading = true;
    else this.packagingPhotoUploading = true;

    this.transactionsService.uploadDamagePhoto(file).subscribe({
      next: ({ url }) => {
        if (type === 'damage') {
          this.damagePhotoUrls = [...this.damagePhotoUrls, url];
          this.damagePhotoUploading = false;
        } else {
          this.packagingPhotoUrls = [...this.packagingPhotoUrls, url];
          this.packagingPhotoUploading = false;
        }
      },
      error: () => {
        this.damageClaimError = 'Failed to upload photo. Please try again.';
        if (type === 'damage') this.damagePhotoUploading = false;
        else this.packagingPhotoUploading = false;
      }
    });
  }

  removeDamagePhoto(url: string, type: 'damage' | 'packaging'): void {
    if (type === 'damage') this.damagePhotoUrls = this.damagePhotoUrls.filter(u => u !== url);
    else this.packagingPhotoUrls = this.packagingPhotoUrls.filter(u => u !== url);
  }

  submitDamageClaim(): void {
    const t = this.damageClaimTransaction;
    if (!t || this.damageClaimSubmitting) return;

    if (this.damagePhotoUrls.length < 1) {
      this.damageClaimError = 'Please upload at least one photo of the damage.';
      return;
    }
    if (this.packagingPhotoUrls.length < 1) {
      this.damageClaimError = 'Please upload at least one photo of the packaging.';
      return;
    }

    this.damageClaimSubmitting = true;
    this.damageClaimError = null;

    this.transactionsService.openDamageClaim({
      transactionId: t._id,
      damagePhotoUrls: this.damagePhotoUrls,
      packagingPhotoUrls: this.packagingPhotoUrls,
      description: this.damageDescription.trim() || undefined
    }).subscribe({
      next: ({ claim }) => {
        this.existingClaimsByTxId[t._id] = claim;
        this.damageClaimSubmitting = false;
        this.damageClaimTransaction = null;
        successToast.fire({ title: 'Damage claim submitted. We\'ll review it shortly.' });
      },
      error: (err) => {
        this.damageClaimError = err?.error?.message || err?.error?.error || 'Failed to submit claim. Please try again.';
        this.damageClaimSubmitting = false;
      }
    });
  }

  closeReturnModal(): void {
    this.returnModalTransaction = null;
    this.returnReason = '';
    this.returnPhotoUrls = [];
    this.returnError = null;
  }

  onReturnEvidenceSelected(input: HTMLInputElement): void {
    const files = input.files;
    if (!files || files.length === 0) return;
    this.returnError = null;
    const maxSize = this.transactionsService.proofOfPaymentMaxSize;
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const toUpload: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > maxSize) { this.returnError = `File ${f.name} is too large (max 30MB).`; input.value = ''; return; }
      if (!allowed.includes(f.type)) { this.returnError = `Only images (JPG, PNG, GIF, WebP) are allowed.`; input.value = ''; return; }
      toUpload.push(f);
    }
    if (toUpload.length + this.returnPhotoUrls.length > 10) {
      this.returnError = 'Maximum 10 photos allowed.'; input.value = ''; return;
    }
    this.returnEvidenceUploading = true;
    let done = 0;
    toUpload.forEach(file => {
      this.transactionsService.uploadReturnEvidence(file).subscribe({
        next: (res) => {
          this.returnPhotoUrls = [...this.returnPhotoUrls, res.url];
          done++;
          if (done === toUpload.length) this.returnEvidenceUploading = false;
        },
        error: () => { this.returnError = 'Upload failed.'; this.returnEvidenceUploading = false; }
      });
    });
    input.value = '';
  }

  canSubmitReturn(): boolean {
    return this.returnReason.trim().length >= 5 && this.returnPhotoUrls.length >= 1;
  }

  submitReturn(): void {
    const t = this.returnModalTransaction;
    if (!t || this.returnSubmitting || !this.canSubmitReturn()) return;
    this.returnSubmitting = true;
    this.returnError = null;
    this.transactionsService.requestReturn(t._id, {
      reason: this.returnReason.trim(),
      photoUrls: this.returnPhotoUrls
    }).subscribe({
      next: (updated) => {
        this.returnSubmitting = false;
        this.closeReturnModal();
        this.replaceTransaction({ ...updated, role: 'buyer' });
        successToast.fire({ title: 'Return request submitted. The seller has 48 hours to respond.' });
      },
      error: (err) => {
        this.returnError = err?.error?.message || 'Failed to submit return request.';
        this.returnSubmitting = false;
      }
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

  private isWithinReviewWindow(t: Transaction): boolean {
    const completed = t.completedAt || t.updatedAt;
    if (!completed) return false;
    return Date.now() - new Date(completed).getTime() <= 30 * 24 * 60 * 60 * 1000;
  }

  /** Whether the current user can leave a review for this transaction (completed + 30-day window + hasn't reviewed) */
  canLeaveReview(t: Transaction): boolean {
    const s = this.getEffectiveStatus(t);
    if (s !== 'completed') return false;
    if (!this.isWithinReviewWindow(t)) return false;
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

  /** Visual tier for 1–5 score buttons (matches review modal styling). */
  scoreTier(i: number): 'low' | 'mid' | 'high' {
    if (i <= 2) return 'low';
    if (i <= 4) return 'mid';
    return 'high';
  }

  submitReview(): void {
    const t = this.reviewModalTransaction;
    if (!t || this.reviewScore < 1 || this.reviewScore > 5) {
      this.reviewError = 'Please select a score from 1 to 5.';
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
