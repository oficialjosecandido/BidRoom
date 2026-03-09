import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { PaymentService, Transaction } from '../../../shared/services/payment.service';

@Component({
  selector: 'app-invoice',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './invoice.component.html',
  styleUrls: ['./invoice.component.scss']
})
export class InvoiceComponent implements OnInit {
  transaction: Transaction | null = null;
  role: 'buyer' | 'seller' | null = null;
  isLoading = true;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private paymentService: PaymentService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadTransaction(id);
    }
  }

  loadTransaction(id: string): void {
    this.paymentService.getTransaction(id).subscribe({
      next: (res) => {
        this.transaction = res.transaction;
        this.role = res.role;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load invoice';
        this.isLoading = false;
      }
    });
  }

  printInvoice(): void {
    window.print();
  }

  formatCurrency(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      pending: 'Payment Pending',
      processing: 'Processing',
      completed: 'Paid',
      failed: 'Payment Failed',
      refunded: 'Refunded',
      disputed: 'Disputed'
    };
    return map[status] || status;
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
    return map[status] || '';
  }
}
