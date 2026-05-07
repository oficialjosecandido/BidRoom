import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { Transaction } from '../../../shared/services/transactions.service';

@Component({
  selector: 'app-admin-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-transactions.component.html',
  styleUrls: ['./admin-transactions.component.scss']
})
export class AdminTransactionsComponent implements OnInit {
  private adminService = inject(AdminService);

  transactions: Transaction[] = [];
  isLoading = false;
  error: string | null = null;

  page = 1;
  readonly pageSize = 25;
  total = 0;
  totalPages = 0;

  selectedStatus = 'all';

  statuses = [
    { value: 'all',                       label: 'All statuses' },
    { value: 'pending_payment',            label: 'Pending payment' },
    { value: 'awaiting_seller_acceptance', label: 'Awaiting seller' },
    { value: 'paid',                       label: 'Paid' },
    { value: 'shipped',                    label: 'Shipped' },
    { value: 'delivered',                  label: 'Delivered' },
    { value: 'under_dispute',              label: 'Under dispute' },
    { value: 'completed',                  label: 'Completed' },
    { value: 'cancelled',                  label: 'Cancelled' }
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading = true;
    this.error = null;
    this.adminService.getTransactions({
      page: this.page,
      limit: this.pageSize,
      status: this.selectedStatus
    }).subscribe({
      next: (res) => {
        this.transactions = res.transactions ?? [];
        this.total        = res.total ?? 0;
        this.totalPages   = Math.max(1, res.pages ?? 1);
        this.page         = Math.max(1, Math.min(res.page ?? 1, this.totalPages));
        this.isLoading    = false;
      },
      error: (err) => {
        this.error     = err?.error?.message || 'Failed to load transactions';
        this.isLoading = false;
      }
    });
  }

  filterChanged(): void {
    this.page = 1;
    this.load();
  }

  goToPage(delta: number): void {
    const next = Math.min(Math.max(1, this.page + delta), this.totalPages);
    if (next === this.page) return;
    this.page = next;
    this.load();
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      pending_payment:            'status-pending',
      awaiting_seller_acceptance: 'status-pending',
      paid:                       'status-paid',
      shipped:                    'status-shipped',
      delivered:                  'status-delivered',
      under_dispute:              'status-dispute',
      completed:                  'status-completed',
      cancelled:                  'status-cancelled'
    };
    return map[status] ?? '';
  }

  statusLabel(status: string): string {
    return this.statuses.find(s => s.value === status)?.label ?? status;
  }

  formatPrice(amount: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount);
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  sellerName(t: Transaction): string {
    return t.seller ? `${t.seller.firstName} ${t.seller.lastName}` : '—';
  }

  buyerName(t: Transaction): string {
    return t.buyer ? `${t.buyer.firstName} ${t.buyer.lastName}` : '—';
  }

  listingTitle(t: Transaction): string {
    return (t.listing as any)?.title ?? '—';
  }

  txStatus(t: Transaction): string {
    return t.transactionStatus ?? (t as any).status ?? '';
  }

  personInitials(name: string): string {
    if (name === '—') return '?';
    const parts = name.trim().split(' ');
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }

  personAvatarColor(name: string): string {
    const palette = ['av-blue', 'av-purple', 'av-teal', 'av-amber', 'av-rose'];
    return palette[(name?.charCodeAt(0) ?? 0) % palette.length];
  }

  transactionDate(t: Transaction): string {
    const d = t.paidAt ?? (t as any).createdAt ?? null;
    return this.formatDate(d);
  }
}
