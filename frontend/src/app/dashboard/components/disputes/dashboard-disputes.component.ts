import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { TransactionsService, Transaction, TransactionStatus } from '../../../shared/services/transactions.service';

const DISPUTE_REASON_LABELS: Record<string, string> = {
  item_not_as_described: 'Item not as described',
  damaged_in_transit: 'Damaged in transit',
  missing_parts: 'Missing parts',
  counterfeit: 'Counterfeit',
  other: 'Other'
};

const successToast = Swal.mixin({
  toast: true,
  position: 'top-end',
  icon: 'success',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true
});

@Component({
  selector: 'app-dashboard-disputes',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './dashboard-disputes.component.html',
  styleUrls: ['./dashboard-disputes.component.scss']
})
export class DashboardDisputesComponent implements OnInit {
  transactionsService = inject(TransactionsService);
  private route = inject(ActivatedRoute);

  transactions: Transaction[] = [];
  eligibleToOpen: Transaction[] = [];
  disputes: Transaction[] = [];
  isLoading = true;
  error: string | null = null;
  updatingId: string | null = null;

  /** Open dispute modal */
  disputeModalTransaction: Transaction | null = null;
  disputeReason = '';
  disputeExplanation = '';
  disputeMediaUrls: string[] = [];
  disputeError: string | null = null;
  disputeSubmitting = false;
  disputeEvidenceUploading = false;

  /** Counter-evidence (seller) */
  counterEvidenceUrlsByTxId: Record<string, string[]> = {};
  counterEvidenceUploadingTxId: string | null = null;

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.isLoading = true;
    this.error = null;
    this.transactionsService.getMyTransactions().subscribe({
      next: (res) => {
        this.transactions = res.transactions || [];
        this.eligibleToOpen = this.transactions.filter(
          t => this.isBuyer(t) && this.getEffectiveStatus(t) === 'shipped' && !t.disputeOpen
        );
        this.disputes = this.transactions.filter(
          t => t.disputeOpen === true && t.disputeAdminVerdict == null
        );
        this.isLoading = false;
        const openId = this.route.snapshot.queryParams['open'];
        if (openId) {
          const t = this.transactions.find(x => x._id === openId);
          if (t && this.isBuyer(t) && this.getEffectiveStatus(t) === 'shipped' && !t.disputeOpen) {
            setTimeout(() => this.openDisputeModal(t), 0);
          }
        }
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Failed to load disputes';
        this.isLoading = false;
      }
    });
  }

  getEffectiveStatus(t: Transaction): TransactionStatus {
    return t.transactionStatus ?? t.status ?? 'pending_payment';
  }

  isBuyer(t: Transaction): boolean {
    return t.role === 'buyer';
  }

  isSeller(t: Transaction): boolean {
    return t.role === 'seller';
  }

  getDisputeReasonLabel(reason: string | null | undefined): string {
    return (reason && DISPUTE_REASON_LABELS[reason]) || reason || 'Unknown';
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

  formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  getExplanationPreview(explanation: string): string {
    return explanation.length > 120 ? explanation.slice(0, 120) + '…' : explanation;
  }

  openDisputeModal(t: Transaction): void {
    if (t.disputeOpen || this.getEffectiveStatus(t) !== 'shipped' || !this.isBuyer(t)) return;
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
      (this.disputeMediaUrls.length >= 3 || this.disputeMediaUrls.length >= 1)
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
    if (toUpload.length + this.disputeMediaUrls.length > 5) {
      this.disputeError = 'Maximum 5 files allowed.';
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
          this.loadData();
        },
        error: (err) => {
          this.disputeError = err?.error?.message || 'Failed to submit dispute.';
          this.disputeSubmitting = false;
        }
      });
  }

  triggerCounterEvidenceUpload(t: Transaction, input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  getCounterEvidenceButtonLabel(t: Transaction): string {
    if (this.counterEvidenceUploadingTxId === t._id) return 'Uploading…';
    const count = (this.counterEvidenceUrlsByTxId[t._id]?.length ?? 0) + (t.disputeSellerCounterMediaUrls?.length ?? 0);
    return count > 0 ? `Add more (${count} uploaded)` : 'Choose files';
  }

  getCounterEvidencePending(t: Transaction): string[] {
    return this.counterEvidenceUrlsByTxId[t._id] ?? [];
  }

  hasEnoughCounterEvidence(t: Transaction): boolean {
    const existing = t.disputeSellerCounterMediaUrls ?? [];
    const pending = this.counterEvidenceUrlsByTxId[t._id] ?? [];
    return existing.length + pending.length >= 1;
  }

  onCounterEvidenceSelected(t: Transaction, input: HTMLInputElement): void {
    const files = input.files;
    if (!files || files.length === 0) return;
    const maxSize = this.transactionsService.proofOfPaymentMaxSize;
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    this.counterEvidenceUploadingTxId = t._id;
    let done = 0;
    let total = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > maxSize || !allowed.includes(f.type)) continue;
      total++;
      this.transactionsService.uploadDisputeEvidence(f).subscribe({
        next: (res) => {
          const prev = this.counterEvidenceUrlsByTxId[t._id] ?? [];
          this.counterEvidenceUrlsByTxId = { ...this.counterEvidenceUrlsByTxId, [t._id]: [...prev, res.url] };
        },
        error: () => {},
        complete: () => {
          done++;
          if (done >= total) this.counterEvidenceUploadingTxId = null;
        }
      });
    }
    if (total === 0) this.counterEvidenceUploadingTxId = null;
    input.value = '';
  }

  submitCounterEvidence(t: Transaction): void {
    const existing = t.disputeSellerCounterMediaUrls ?? [];
    const pending = this.counterEvidenceUrlsByTxId[t._id] ?? [];
    const all = [...existing, ...pending];
    if (all.length === 0 || this.updatingId) return;
    this.updatingId = t._id;
    this.transactionsService.updateDisputeCounterEvidence(t._id, all).subscribe({
      next: () => {
        this.updatingId = null;
        this.counterEvidenceUrlsByTxId = { ...this.counterEvidenceUrlsByTxId, [t._id]: [] };
        successToast.fire({ title: 'Counter-evidence submitted' });
        this.loadData();
      },
      error: () => (this.updatingId = null)
    });
  }
}
