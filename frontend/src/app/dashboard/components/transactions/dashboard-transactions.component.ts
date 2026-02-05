import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TransactionsService, Transaction, TransactionStatus } from '../../../shared/services/transactions.service';

@Component({
  selector: 'app-dashboard-transactions',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './dashboard-transactions.component.html',
  styleUrls: ['./dashboard-transactions.component.scss']
})
export class DashboardTransactionsComponent implements OnInit {
  transactions: Transaction[] = [];
  isLoading = true;
  error: string | null = null;
  updatingId: string | null = null;
  showTrackingFormId: string | null = null;
  trackingNumber = '';
  trackingCarrier = '';

  constructor(private transactionsService: TransactionsService) {}

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

  getStatusLabel(status: TransactionStatus): string {
    const labels: Record<TransactionStatus, string> = {
      pending_payment: 'Pending payment',
      paid: 'Paid',
      shipped: 'Shipped',
      delivered: 'Delivered',
      completed: 'Completed',
      cancelled: 'Cancelled'
    };
    return labels[status] || status;
  }

  getStatusClass(status: TransactionStatus): string {
    const classes: Record<TransactionStatus, string> = {
      pending_payment: 'status-pending',
      paid: 'status-paid',
      shipped: 'status-shipped',
      delivered: 'status-delivered',
      completed: 'status-completed',
      cancelled: 'status-cancelled'
    };
    return classes[status] || '';
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

  markAsPaid(t: Transaction): void {
    if (this.updatingId || t.role !== 'buyer' || this.getEffectiveStatus(t) !== 'pending_payment') return;
    this.updatingId = t._id;
    this.transactionsService.updateTransaction(t._id, { status: 'paid' }).subscribe({
      next: (updated) => {
        this.replaceTransaction(updated);
        this.updatingId = null;
      },
      error: () => (this.updatingId = null)
    });
  }

  markAsDelivered(t: Transaction): void {
    if (this.updatingId || t.role !== 'buyer' || t.status !== 'shipped') return;
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

  submitShipped(t: Transaction): void {
    if (this.updatingId || t.role !== 'seller' || (t.status !== 'pending_payment' && t.status !== 'paid')) return;
    this.updatingId = t._id;
    this.transactionsService
      .updateTransaction(t._id, {
        status: 'shipped',
        trackingNumber: this.trackingNumber || undefined,
        trackingCarrier: this.trackingCarrier || undefined
      })
      .subscribe({
        next: (updated) => {
          this.replaceTransaction(updated);
          this.updatingId = null;
          this.showTrackingFormId = null;
          this.trackingNumber = '';
          this.trackingCarrier = '';
        },
        error: () => (this.updatingId = null)
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
