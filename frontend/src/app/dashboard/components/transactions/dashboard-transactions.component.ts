import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import Swal from 'sweetalert2';
import { TransactionsService, Transaction, TransactionStatus, DamageClaim } from '../../../shared/services/transactions.service';
import { ReviewsService } from '../../../shared/services/reviews.service';
import { StripeConnectService } from '../../../shared/services/stripe-connect.service';
import { ShippingService, ShippingRate, DeliveryAddress } from '../../../shared/services/shipping.service';
import { PostHogService } from '../../../shared/services/posthog.service';
import { AnalyticsEvents } from '../../../shared/services/analytics.events';

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
  private postHog = inject(PostHogService);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);
  transactions: Transaction[] = [];
  isLoading = true;
  error: string | null = null;
  updatingId: string | null = null;
  /** Review modal */
  reviewModalTransaction: Transaction | null = null;
  reviewScore = 0;
  reviewScoreHover = 0;
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
  /** Selected payment method per transaction (local, before submitting) */
  selectedPaymentMethodMap: Record<string, 'stripe' | 'in_person' | 'bank_transfer' | 'mbway'> = {};
  /** Transaction ID currently submitting manual payment */
  manualPaymentSendingId: string | null = null;
  manualPaymentError: string | null = null;
  /** Proof of delivery (seller): uploaded URL and file name per transaction. */
  deliveryProofUploadedUrlByTxId: Record<string, string> = {};
  deliveryProofFileNameByTxId: Record<string, string> = {};
  deliveryProofUploadingTxId: string | null = null;
  deliveryProofErrorByTxId: Record<string, string> = {};
  /** Shipping rate flow state */
  shippingRatesTxId: string | null = null;      // txId for which rate panel is open
  shippingRates: ShippingRate[] = [];
  shippingRatesLoading = false;
  shippingRatesError: string | null = null;
  lockingRateTxId: string | null = null;
  /** Delivery address form used for shipping rate calculation */
  deliveryAddress: DeliveryAddress = { street1: '', city: '', state: '', postalCode: '', country: 'PT' };

  /** Countries where carrier APIs expect a state/province code (US, CA, AU). */
  private readonly stateRequiredCountries = new Set(['US', 'CA', 'AU']);

  readonly shippingCountries = [
    'PT', 'ES', 'FR', 'DE', 'IT', 'GB', 'IE', 'NL', 'BE', 'CH', 'AT', 'LU', 'US', 'CA', 'AU',
  ];
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

  /** Filter pills */
  txFilter: 'all' | 'pending_payment' | 'shipping' | 'delivered' | 'completed' | 'disputed' = 'all';

  /** Slide-in drawer */
  drawerTx: Transaction | null = null;

  /** Row selected in the table — shows the management panel below */
  selectedTx: Transaction | null = null;

  get filteredTransactions(): Transaction[] {
    if (this.txFilter === 'all') return this.transactions;
    return this.transactions.filter(t => {
      const s = this.getEffectiveStatus(t);
      switch (this.txFilter) {
        case 'pending_payment': return s === 'pending_payment';
        case 'shipping': return s === 'awaiting_seller_acceptance' || s === 'paid' || s === 'shipped';
        case 'delivered': return s === 'delivered';
        case 'completed': return s === 'completed' || s === 'cancelled';
        case 'disputed': return s === 'under_dispute' || t.disputeOpen;
        default: return true;
      }
    });
  }

  openDrawer(t: Transaction): void { this.drawerTx = t; }
  closeDrawer(): void { this.drawerTx = null; }

  selectTransaction(t: Transaction): void {
    this.selectedTx = this.selectedTx?._id === t._id ? null : t;
    if (this.selectedTx) {
      setTimeout(() => {
        document.getElementById(`transaction-${t._id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }

  getRoleLabel(t: Transaction): string {
    return this.isBuyer(t)
      ? this.translate.instant('transactions.buyer')
      : this.translate.instant('transactions.seller');
  }

  getDrawerProgressStep(t: Transaction): number {
    const s = this.getEffectiveStatus(t);
    if (s === 'completed' || s === 'cancelled') return 4;
    if (s === 'delivered') return 3;
    if (s === 'shipped' || s === 'paid' || s === 'awaiting_seller_acceptance') return 2;
    return 1;
  }

  getTxStatusBadgeClass(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (t.disputeOpen || s === 'under_dispute') return 'tbs-dispute';
    if (s === 'pending_payment') return 'tbs-payment';
    if (s === 'awaiting_seller_acceptance' || s === 'paid' || s === 'shipped') return 'tbs-shipping';
    if (s === 'delivered') return 'tbs-delivered';
    if (s === 'completed' || s === 'cancelled') return 'tbs-completed';
    return 'tbs-completed';
  }

  getSimpleStatusLabel(t: Transaction): string {
    const s = this.getEffectiveStatus(t);
    if (t.disputeOpen || s === 'under_dispute') return 'Dispute';
    const map: Partial<Record<TransactionStatus, string>> = {
      pending_payment: 'Pending payment',
      awaiting_seller_acceptance: 'In transit',
      paid: 'In transit',
      shipped: 'In transit',
      delivered: 'Delivered',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    return map[s] ?? s;
  }

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
        this.syncSelectedTransactions();
        this.isLoading = false;
        this.scrollToTransactionFromFragment();
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || this.translate.instant('transactions.errorLoading');
        this.isLoading = false;
      }
    });
  }

  private scrollToTransactionAfterLoad(fragment: string): void {
    if (!this.isLoading && this.transactions.length > 0) {
      this.scrollToTransactionFromFragment();
    }
  }

  private scrollToTransactionFromFragment(): void {
    const fragment = this.route.snapshot.fragment;
    if (!fragment?.startsWith('transaction-')) return;
    const id = fragment.slice('transaction-'.length);
    const t = this.transactions.find(tx => tx._id === id);
    if (t) this.selectedTx = t;
    setTimeout(() => {
      document.getElementById(fragment)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
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

  /** Transaction flow finished and both parties have reviewed */
  isFullyCompleted(t: Transaction): boolean {
    return this.isDone(t) && this.hasBothReviewed(t);
  }

  /** Buyer can mark as completed once item flow reached paid/shipped/delivered */
  canMarkAsCompleted(t: Transaction): boolean {
    return ['paid', 'shipped', 'delivered'].includes(this.getEffectiveStatus(t));
  }

  getStatusLabel(status: TransactionStatus): string {
    const labels: Record<TransactionStatus, string> = {
      pending_payment: 'Pending payment',
      awaiting_seller_acceptance: 'Awaiting seller acceptance',
      manual_payment_sent: 'Payment sent',
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
      awaiting_seller_acceptance: this.hasVerifiedPayment(t)
        ? this.translate.instant('transactions.buyingStatus.paid')
        : this.translate.instant('transactions.buyingStatus.paymentSubmitted'),
      manual_payment_sent: this.translate.instant('transactions.buyingStatus.paymentSubmitted'),
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
      awaiting_seller_acceptance: this.hasVerifiedPayment(t)
        ? this.translate.instant('transactions.sellingStatus.pendingShipment')
        : this.translate.instant('transactions.sellingStatus.pendingAcceptance'),
      manual_payment_sent: this.translate.instant('transactions.sellingStatus.pendingAcceptance'),
      paid: this.translate.instant('transactions.sellingStatus.paymentReceived'),
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
      manual_payment_sent: 'status-paid',
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
      awaiting_seller_acceptance: this.hasVerifiedPayment(t) ? 'status-paid' : 'status-pending',
      manual_payment_sent: 'status-pending',
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
      manual_payment_sent: 'status-pending',
      paid: 'status-paid',
      shipped: 'status-shipped',
      delivered: 'status-delivered',
      under_dispute: 'status-dispute',
      completed: 'status-completed',
      cancelled: 'status-cancelled'
    };
    return classes[status] || '';
  }

  isStripePaid(t: Transaction): boolean {
    return !!(t.stripePaymentIntentId || t.stripeCheckoutSessionId);
  }

  /** Payment verified (Stripe or paymentStatus paid) — no manual seller acceptance. */
  hasVerifiedPayment(t: Transaction): boolean {
    return t.paymentStatus === 'paid' || this.isStripePaid(t);
  }

  /** Manual (non-Stripe) payment — seller must confirm receipt before shipping. */
  canSellerAcceptPayment(t: Transaction): boolean {
    return this.getEffectiveStatus(t) === 'awaiting_seller_acceptance' && !this.hasVerifiedPayment(t);
  }

  /** Seller can upload proof and mark shipped once payment is verified. */
  canSellerPrepareShipment(t: Transaction): boolean {
    if (!this.isSeller(t)) return false;
    const s = this.getEffectiveStatus(t);
    return s === 'paid' || (s === 'awaiting_seller_acceptance' && this.hasVerifiedPayment(t));
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
    if (!this.isStripeAvailable(t)) {
      this.stripePaymentError = this.translate.instant('transactions.stripeNotAvailable');
      return;
    }
    if (this.needsShippingRate(t)) {
      this.openShippingPanel(t);
      return;
    }
    this.stripePayingTxId = t._id;
    this.stripePaymentError = null;
    this.stripeConnect.createCheckoutSession(t._id).subscribe({
      next: (res) => {
        this.postHog.track(AnalyticsEvents.CHECKOUT_STARTED, {
          listing_id: t.listing?._id ?? t._id,
          listing_slug: t.listing?.slug,
          amount: t.amount,
        });
        window.location.href = res.url;
      },
      error: (err) => {
        this.stripePayingTxId = null;
        const body = err?.error;
        const apiError = body?.error;
        if (apiError === 'Payment already completed' && body?.sessionId) {
          this.confirmStripePayment(body.sessionId, t._id);
          return;
        }
        if (apiError === 'stripe_limit_exceeded') {
          this.stripePaymentError = body?.message || this.translate.instant('transactions.stripeNotAvailable');
        } else if (apiError === 'Seller not ready') {
          this.stripePaymentError = `Payment unavailable: the seller has not connected their Stripe account yet. ` +
            `Please contact the seller (${t.seller?.firstName} ${t.seller?.lastName}) or wait for them to complete their payment setup.`;
        } else {
          this.stripePaymentError = body?.message || apiError || this.translate.instant('transactions.stripePaymentError');
        }
      }
    });
  }

  /** Returns true if the transaction has any non-Stripe payment methods available */
  hasManualPaymentMethods(t: Transaction): boolean {
    const cfg = t.seller?.sellerPaymentConfig;
    const apm = t.listing?.acceptedPaymentMethods;
    if (!cfg || !apm) return false;
    return !!(
      (apm.inPerson && cfg.inPerson === true) ||
      (apm.bankTransfer && cfg.bankTransfer?.enabled === true) ||
      (apm.mbway && cfg.mbway?.enabled === true)
    );
  }

  /** Stripe is available if amount is at or below €10,000 */
  isStripeAvailable(t: Transaction): boolean {
    return t.amount <= 10000;
  }

  getSelectedMethod(t: Transaction): 'stripe' | 'in_person' | 'bank_transfer' | 'mbway' {
    if (this.selectedPaymentMethodMap[t._id]) return this.selectedPaymentMethodMap[t._id];
    return this.isStripeAvailable(t) ? 'stripe' : 'in_person';
  }

  setPaymentMethod(t: Transaction, method: 'stripe' | 'in_person' | 'bank_transfer' | 'mbway'): void {
    this.selectedPaymentMethodMap[t._id] = method;
    this.manualPaymentError = null;
    this.stripePaymentError = null;
  }

  markManualPaymentSent(t: Transaction, method: 'in_person' | 'bank_transfer' | 'mbway'): void {
    if (this.manualPaymentSendingId || t.role !== 'buyer' || this.getEffectiveStatus(t) !== 'pending_payment') return;
    this.manualPaymentSendingId = t._id;
    this.manualPaymentError = null;
    this.transactionsService
      .updateTransaction(t._id, { status: 'manual_payment_sent', paymentMethod: method })
      .subscribe({
        next: (updated) => {
          this.replaceTransaction({ ...updated, role: 'buyer' });
          this.manualPaymentSendingId = null;
          successToast.fire({ title: this.translate.instant('transactions.manualPaymentSentConfirmation') });
        },
        error: (err) => {
          this.manualPaymentSendingId = null;
          this.manualPaymentError = err?.error?.message || this.translate.instant('transactions.manualPaymentError');
        }
      });
  }

  confirmStripePayment(sessionId: string, transactionId: string): void {
    this.stripeConfirmingTxId = transactionId;
    this.stripeConnect.confirmPayment(sessionId, transactionId).subscribe({
      next: (updated) => {
        this.stripeConfirmingTxId = null;
        this.replaceTransaction({ ...updated, role: 'buyer' });
        this.postHog.track(AnalyticsEvents.PAYMENT_COMPLETED, {
          listing_id: updated.listing?._id ?? transactionId,
          listing_slug: updated.listing?.slug,
          amount: updated.amount,
          payment_method: 'stripe',
        });
        successToast.fire({ title: 'Payment confirmed! The seller has been notified.' });
      },
      error: (err) => {
        this.stripeConfirmingTxId = null;
        this.stripePaymentError = err?.error?.message || 'Could not confirm payment. Please contact support if funds were charged.';
      }
    });
  }

  /**
   * BidRoom commission deducted from the SELLER payout (3.5% standard, 6% private room, max €500).
   * Uses the stored amount when available; falls back to the commission rate on the listing.
   * The buyer pays 0% BidRoom commission — they only pay the Stripe processing fee.
   */
  getSellerCommission(t: Transaction): number {
    if (t.bidRoomFeeAmount != null) return t.bidRoomFeeAmount;
    const rate = t.listing?.commissionRate ?? 0.035;
    return Math.min(t.amount * rate, 500);
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
        country: t.buyerDeliveryAddress.country || 'PT'
      };
    } else {
      this.deliveryAddress = { street1: '', city: '', state: '', postalCode: '', country: 'PT' };
    }
  }

  deliveryAddressRequiresState(): boolean {
    return this.stateRequiredCountries.has((this.deliveryAddress.country || '').toUpperCase());
  }

  isDeliveryAddressComplete(): boolean {
    const addr = this.deliveryAddress;
    if (!addr.street1?.trim() || !addr.city?.trim() || !addr.postalCode?.trim()) return false;
    if (this.deliveryAddressRequiresState() && !addr.state?.trim()) return false;
    return true;
  }

  closeShippingPanel(): void {
    this.shippingRatesTxId = null;
    this.shippingRates = [];
    this.shippingRatesError = null;
  }

  /** Fetch carrier rates from the backend */
  fetchShippingRates(t: Transaction): void {
    const addr = this.deliveryAddress;
    if (!this.isDeliveryAddressComplete()) {
      this.shippingRatesError = this.translate.instant(
        this.deliveryAddressRequiresState()
          ? 'transactions.addressIncompleteWithState'
          : 'transactions.addressIncomplete'
      );
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
        this.shippingRatesError = err?.error?.message || this.translate.instant('transactions.shippingRatesError');
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

  /**
   * Seller payout: bid + shipping − BidRoom commission (3.5% standard, 6% private room).
   * Uses the stored payout amount when available; otherwise deducts the commission.
   */
  getSellerNet(t: Transaction): number {
    const shipping = this.getShippingAmount(t) ?? 0;
    const commission = this.getSellerCommission(t);
    return t.amount + shipping - commission;
  }

  /**
   * Buyer total: bid + Stripe processing fee + shipping.
   * Buyer pays 0% BidRoom commission — only the Stripe processing fee applies.
   * Stripe fee is only known after payment; estimated total excludes it if unavailable.
   */
  getBuyerTotal(t: Transaction): number | null {
    if (t.buyerTotalPaid != null) return t.buyerTotalPaid;
    const stripeFee = this.getStripeFee(t) ?? 0;
    const shipping = this.getShippingAmount(t);
    return shipping !== null ? t.amount + stripeFee + shipping : null;
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
    const rate = t.listing?.commissionRate ?? 0.035;
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

  hasPaymentDeadlinePassed(t: Transaction): boolean {
    if (!t.paymentDeadline) return false;
    return new Date(t.paymentDeadline) < new Date();
  }

  markAsDelivered(t: Transaction): void {
    if (this.updatingId || t.role !== 'buyer' || this.getEffectiveStatus(t) !== 'shipped') return;
    const shippedAt = t.shippedAt ? new Date(t.shippedAt) : null;
    this.updatingId = t._id;
    this.transactionsService.updateTransaction(t._id, { status: 'delivered' }).subscribe({
      next: (updated) => {
        this.replaceTransaction(updated);
        this.updatingId = null;
        const daysToReceive = shippedAt
          ? Math.round((Date.now() - shippedAt.getTime()) / 86_400_000)
          : undefined;
        this.postHog.track(AnalyticsEvents.ITEM_RECEIVED, {
          listing_id: t.listing?._id ?? t._id,
          listing_slug: t.listing?.slug,
          ...(daysToReceive !== undefined && { days_to_receive: daysToReceive }),
        });
        successToast.fire({ title: this.translate.instant('transactions.receivedConfirmedToast') });
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

  triggerDeliveryProofUpload(t: Transaction, input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  hasDeliveryProofUploaded(t: Transaction): boolean {
    return !!this.deliveryProofUploadedUrlByTxId[t._id];
  }

  getDeliveryProofUploadButtonLabel(t: Transaction): string {
    if (this.deliveryProofUploadingTxId === t._id) return this.translate.instant('transactions.uploadingProof');
    if (this.deliveryProofUploadedUrlByTxId[t._id]) return this.translate.instant('transactions.proofUploaded');
    return this.translate.instant('transactions.uploadProofOptional');
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
    if (this.updatingId || t.role !== 'seller' || !this.canSellerPrepareShipment(t)) return;
    const proofUrl = this.deliveryProofUploadedUrlByTxId[t._id];
    this.updatingId = t._id;
    this.transactionsService
      .updateTransaction(t._id, {
        status: 'shipped',
        trackingNumber: this.trackingNumber?.trim() || undefined,
        trackingCarrier: this.trackingCarrier || undefined,
        estimatedDeliveryDays: this.estimatedDeliveryDays ?? undefined,
        sellerProofOfDeliveryUrl: proofUrl || undefined
      })
      .subscribe({
        next: (updated) => {
          this.replaceTransaction(updated);
          this.updatingId = null;
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
    if (t.listing?.returnPolicy === 'no-returns') return false;
    if (t.returnRequestedAt) return false; // already submitted
    if (!t.deliveredAt) return true; // no deliveredAt recorded — allow
    const returnDays = this.returnWindowDays(t);
    const deadline = new Date(t.deliveredAt);
    deadline.setDate(deadline.getDate() + returnDays);
    return new Date() <= deadline;
  }

  /** Return window in days based on the listing's return policy. */
  private returnWindowDays(t: Transaction): number {
    switch (t.listing?.returnPolicy) {
      case '30-days': return 30;
      case '14-days': return 14;
      case '7-days':  return 7;
      default:        return 7;
    }
  }

  /** Days remaining in return window */
  returnWindowDaysLeft(t: Transaction): number {
    const days = this.returnWindowDays(t);
    if (!t.deliveredAt) return days;
    const deadline = new Date(t.deliveredAt);
    deadline.setDate(deadline.getDate() + days);
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
    const s = this.getEffectiveStatus(t);
    // Allow reporting damage when the item has been shipped (before confirming receipt)
    // or within 48h after the buyer confirmed delivery.
    if (s === 'shipped') return this.existingClaimsByTxId[t._id] === undefined;
    if (s !== 'delivered') return false;
    if (!t.deliveredAt) return false;
    const elapsed = Date.now() - new Date(t.deliveredAt).getTime();
    if (elapsed > this.CLAIM_WINDOW_MS) return false;
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
        this.damageClaimError = this.translate.instant('transactions.damageClaimUploadError');
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
        this.damageClaimError = err?.error?.message || err?.error?.error || this.translate.instant('transactions.damageClaimSubmitError');
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
        this.returnError = err?.error?.message || this.translate.instant('transactions.returnError');
        this.returnSubmitting = false;
      }
    });
  }

  private isWithinReviewWindow(t: Transaction): boolean {
    const completed = t.completedAt || t.updatedAt;
    if (!completed) return false;
    return Date.now() - new Date(completed).getTime() <= 30 * 24 * 60 * 60 * 1000;
  }

  /** Whether the current user has already submitted their review for this transaction. */
  hasCurrentUserReviewed(t: Transaction): boolean {
    if (this.isBuyer(t)) return !!t.buyerHasReviewedSeller;
    if (this.isSeller(t)) return !!t.sellerHasReviewedBuyer;
    return false;
  }

  /** Whether the current user can leave a review for this transaction (completed + 30-day window + hasn't reviewed) */
  canLeaveReview(t: Transaction): boolean {
    const s = this.getEffectiveStatus(t);
    if (s !== 'completed') return false;
    if (!this.isWithinReviewWindow(t)) return false;
    return !this.hasCurrentUserReviewed(t);
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
    if (!this.canLeaveReview(t)) return;
    this.reviewModalTransaction = t;
    this.reviewScore = 0;
    this.reviewScoreHover = 0;
    this.reviewDescription = '';
    this.reviewError = null;
  }

  closeReviewModal(): void {
    this.reviewModalTransaction = null;
    this.reviewScore = 0;
    this.reviewScoreHover = 0;
    this.reviewDescription = '';
    this.reviewError = null;
  }

  setReviewScore(n: number): void {
    this.reviewScore = n;
    this.reviewScoreHover = 0;
    this.reviewError = null;
  }

  setReviewScoreHover(n: number): void {
    this.reviewScoreHover = n;
  }

  clearReviewScoreHover(): void {
    this.reviewScoreHover = 0;
  }

  /** Active score for star fill (committed or hover preview). */
  displayReviewScore(): number {
    return this.reviewScore || this.reviewScoreHover;
  }

  getScoreEmoji(score: number): string {
    if (score <= 1) return '😞';
    if (score <= 2) return '😐';
    if (score <= 3) return '🙂';
    if (score <= 4) return '😊';
    return '🎉';
  }

  getScoreLabel(score: number): string {
    return this.translate.instant(`transactions.scoreReactions.${score}`);
  }

  submitReview(): void {
    const t = this.reviewModalTransaction;
    if (!t || this.reviewScore < 1 || this.reviewScore > 5) {
      this.reviewError = this.translate.instant('transactions.selectScore');
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
          if (t) {
            const updated: Transaction = {
              ...t,
              buyerHasReviewedSeller: this.isBuyer(t) ? true : t.buyerHasReviewedSeller,
              sellerHasReviewedBuyer: this.isSeller(t) ? true : t.sellerHasReviewedBuyer
            };
            this.replaceTransaction(updated);
          }
          this.closeReviewModal();
          this.loadTransactions();
          successToast.fire({ title: this.translate.instant('transactions.reviewSubmitted') });
        },
        error: (err) => {
          this.reviewSubmitting = false;
          this.reviewError = err?.error?.message || this.translate.instant('transactions.reviewError');
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
          this.disputeError = err?.error?.message || this.translate.instant('transactions.disputeError');
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

  private syncSelectedTransactions(): void {
    if (this.selectedTx) {
      const match = this.transactions.find((tx) => tx._id === this.selectedTx!._id);
      if (match) this.selectedTx = match;
    }
    if (this.drawerTx) {
      const match = this.transactions.find((tx) => tx._id === this.drawerTx!._id);
      if (match) this.drawerTx = match;
    }
  }

  private replaceTransaction(updated: Transaction): void {
    const idx = this.transactions.findIndex((x) => x._id === updated._id);
    if (idx === -1) return;

    const role = this.transactions[idx].role;
    const merged: Transaction = {
      ...updated,
      role,
      transactionStatus: updated.transactionStatus ?? updated.status,
      paymentStatus: updated.paymentStatus,
      sendingStatus: updated.sendingStatus
    };

    this.transactions = [
      ...this.transactions.slice(0, idx),
      merged,
      ...this.transactions.slice(idx + 1)
    ];

    if (this.selectedTx?._id === merged._id) {
      this.selectedTx = merged;
    }
    if (this.drawerTx?._id === merged._id) {
      this.drawerTx = merged;
    }
  }

}
