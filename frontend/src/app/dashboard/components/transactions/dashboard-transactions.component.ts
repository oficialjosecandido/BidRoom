import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { TransactionsService, Transaction, TransactionStatus } from '../../../shared/services/transactions.service';
import { ReviewsService } from '../../../shared/services/reviews.service';

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
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './dashboard-transactions.component.html',
  styleUrls: ['./dashboard-transactions.component.scss']
})
export class DashboardTransactionsComponent implements OnInit {
  transactionsService = inject(TransactionsService);
  private reviewsService = inject(ReviewsService);

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
  showTrackingFormId: string | null = null;
  trackingNumber = '';
  trackingCarrier = '';
  showBankFormId: string | null = null;
  bankIban = '';
  bankSwift = '';
  bankAccountName = '';
  showProofInputId: string | null = null;
  /** Selected proof file per transaction (one file, PDF/JPG/PNG, max 30MB). */
  proofSelectedFileByTxId: Record<string, File> = {};
  proofSelectedFileNameByTxId: Record<string, string> = {};
  /** Uploaded proof URL per transaction (set after successful upload; enables "Mark as paid"). */
  proofUploadedUrlByTxId: Record<string, string> = {};
  proofUploadErrorByTxId: Record<string, string> = {};
  /** Transaction ID currently uploading proof (for "Uploading…" label). */
  proofUploadingTxId: string | null = null;
  /** Proof of delivery (seller): uploaded URL and file name per transaction. */
  deliveryProofUploadedUrlByTxId: Record<string, string> = {};
  deliveryProofFileNameByTxId: Record<string, string> = {};
  deliveryProofUploadingTxId: string | null = null;
  deliveryProofErrorByTxId: Record<string, string> = {};

  ngOnInit(): void {
    this.loadTransactions();
  }

  loadTransactions(): void {
    this.isLoading = true;
    this.error = null;
    this.transactionsService.getMyTransactions().subscribe({
      next: (res) => {
        this.transactions = res.transactions || [];
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Failed to load transactions';
        this.isLoading = false;
      }
    });
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

  /** Can mark as completed only when delivered (or paid/shipped) AND both have reviewed */
  canMarkAsCompleted(t: Transaction): boolean {
    return (
      ['paid', 'shipped', 'delivered'].includes(this.getEffectiveStatus(t)) &&
      this.hasBothReviewed(t)
    );
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
    if (['delivered', 'completed'].includes(s) && !t.buyerHasReviewedSeller) {
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
    if (['delivered', 'completed'].includes(s) && !t.sellerHasReviewedBuyer) {
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
    if (['delivered', 'completed'].includes(s) && !t.buyerHasReviewedSeller) {
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
    if (['delivered', 'completed'].includes(s) && !t.sellerHasReviewedBuyer) {
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

  getListingImage(t: Transaction): string {
    const img = t.listing?.images?.[0];
    return img || 'https://via.placeholder.com/400x300?text=No+Image';
  }

  getListingUrl(t: Transaction): string {
    const slug = t.listing?.slug;
    return slug ? `/listing/${slug}` : '#';
  }

  getPaymentUrl(t: Transaction): string {
    const slug = t.listing?.slug;
    return slug ? `/listing/${slug}/payment` : '#';
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

  hasSellerBankDetails(t: Transaction): boolean {
    return !!(t.sellerBankIban || t.sellerBankSwift || t.sellerBankAccountName);
  }

  toggleBankForm(t: Transaction): void {
    if (this.showBankFormId === t._id) {
      this.showBankFormId = null;
      this.bankIban = '';
      this.bankSwift = '';
      this.bankAccountName = '';
    } else {
      this.showBankFormId = t._id;
      this.bankIban = t.sellerBankIban || '';
      this.bankSwift = t.sellerBankSwift || '';
      this.bankAccountName = t.sellerBankAccountName || '';
    }
  }

  submitBankDetails(t: Transaction): void {
    if (this.updatingId || t.role !== 'seller') return;
    this.updatingId = t._id;
    this.transactionsService
      .updateTransaction(t._id, {
        sellerBankIban: this.bankIban || undefined,
        sellerBankSwift: this.bankSwift || undefined,
        sellerBankAccountName: this.bankAccountName || undefined
      })
      .subscribe({
        next: (updated) => {
          this.replaceTransaction(updated);
          this.updatingId = null;
          this.showBankFormId = null;
          this.bankIban = '';
          this.bankSwift = '';
          this.bankAccountName = '';
        },
        error: () => (this.updatingId = null)
      });
  }

  toggleProofInput(t: Transaction): void {
    if (this.showProofInputId === t._id) {
      this.showProofInputId = null;
      delete this.proofSelectedFileByTxId[t._id];
      delete this.proofSelectedFileNameByTxId[t._id];
      delete this.proofUploadedUrlByTxId[t._id];
      delete this.proofUploadErrorByTxId[t._id];
    } else {
      this.showProofInputId = t._id;
    }
  }

  getProofUploadError(t: Transaction): string | null {
    return this.proofUploadErrorByTxId[t._id] || null;
  }

  triggerProofUpload(t: Transaction, input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  hasProofUploaded(t: Transaction): boolean {
    return !!this.proofUploadedUrlByTxId[t._id];
  }

  getProofUploadButtonLabel(t: Transaction): string {
    if (this.proofUploadingTxId === t._id) return 'Uploading…';
    if (this.proofUploadedUrlByTxId[t._id]) return 'Proof uploaded';
    return 'Upload proof of payment';
  }

  getProofFileName(t: Transaction): string {
    return this.proofSelectedFileNameByTxId[t._id] || '';
  }

  getProofUploadedUrl(t: Transaction): string | null {
    return this.proofUploadedUrlByTxId[t._id] || null;
  }

  removeProof(t: Transaction): void {
    delete this.proofUploadedUrlByTxId[t._id];
    delete this.proofSelectedFileNameByTxId[t._id];
    delete this.proofUploadErrorByTxId[t._id];
  }

  onProofFileSelected(t: Transaction, input: HTMLInputElement): void {
    delete this.proofUploadErrorByTxId[t._id];
    const file = input.files?.[0];
    if (!file) return;

    const maxSize = this.transactionsService.proofOfPaymentMaxSize;
    if (file.size > maxSize) {
      this.proofUploadErrorByTxId[t._id] = `File must be 30MB or less (${(file.size / 1024 / 1024).toFixed(1)}MB selected).`;
      input.value = '';
      return;
    }
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowed.includes(file.type)) {
      this.proofUploadErrorByTxId[t._id] = 'Only PDF, JPG and PNG files are allowed.';
      input.value = '';
      return;
    }

    this.proofUploadingTxId = t._id;
    this.transactionsService.uploadProofOfPayment(file).subscribe({
      next: (res) => {
        this.proofUploadedUrlByTxId[t._id] = res.url;
        this.proofSelectedFileNameByTxId[t._id] = file.name;
        this.proofUploadingTxId = null;
        delete this.proofUploadErrorByTxId[t._id];
        input.value = '';
      },
      error: (err) => {
        this.proofUploadErrorByTxId[t._id] = err.error?.message || 'Upload failed. Try again.';
        this.proofUploadingTxId = null;
        input.value = '';
      }
    });
  }

  markAsPaid(t: Transaction): void {
    if (this.updatingId || t.role !== 'buyer' || this.getEffectiveStatus(t) !== 'pending_payment') return;
    const url = this.proofUploadedUrlByTxId[t._id];
    if (!url) return;

    this.updatingId = t._id;
    this.transactionsService
      .updateTransaction(t._id, { status: 'paid', buyerProofOfPaymentUrl: url })
      .subscribe({
        next: (updated) => {
          this.replaceTransaction(updated);
          this.updatingId = null;
          delete this.proofSelectedFileByTxId[t._id];
          delete this.proofSelectedFileNameByTxId[t._id];
          delete this.proofUploadedUrlByTxId[t._id];
          delete this.proofUploadErrorByTxId[t._id];
          successToast.fire({ title: 'Payment information sent' });
        },
        error: () => (this.updatingId = null)
      });
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
