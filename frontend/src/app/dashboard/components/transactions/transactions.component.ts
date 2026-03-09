import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PaymentService, Transaction } from '../../../shared/services/payment.service';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss']
})
export class TransactionsComponent implements OnInit {
  transactions: Transaction[] = [];
  total = 0;
  isLoading = true;
  error: string | null = null;
  activeRole: 'all' | 'buyer' | 'seller' = 'all';
  activeStatus = '';

  constructor(private paymentService: PaymentService) {}

  ngOnInit(): void {
    this.loadTransactions();
  }

  loadTransactions(): void {
    this.isLoading = true;
    this.error = null;

    const params: { role?: 'buyer' | 'seller'; status?: string } = {};
    if (this.activeRole !== 'all') params.role = this.activeRole;
    if (this.activeStatus) params.status = this.activeStatus;

    this.paymentService.getTransactions(params).subscribe({
      next: (res) => {
        this.transactions = res.transactions;
        this.total = res.total;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load transactions';
        this.isLoading = false;
      }
    });
  }

  setRole(role: 'all' | 'buyer' | 'seller'): void {
    this.activeRole = role;
    this.loadTransactions();
  }

  setStatus(status: string): void {
    this.activeStatus = status;
    this.loadTransactions();
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      pending: 'status-pending',
      processing: 'status-processing',
      completed: 'status-completed',
      failed: 'status-failed',
      refunded: 'status-refunded',
      disputed: 'status-disputed'
    };
    return map[status] || 'status-pending';
  }

  formatCurrency(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
}
