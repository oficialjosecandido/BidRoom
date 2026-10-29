import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AdminCustomerDetails,
  AdminCustomerHistoryItem,
  AdminService,
} from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

@Component({
  selector: 'app-admin-customer-details',
  standalone: true,
  imports: [CommonModule, RouterLink, AdminSidebarComponent],
  templateUrl: './admin-customer-details.component.html',
  styleUrls: ['./admin-customer-details.component.scss'],
})
export class AdminCustomerDetailsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private adminService = inject(AdminService);

  customerId = '';
  customer: AdminCustomerDetails | null = null;
  purchases: AdminCustomerHistoryItem[] = [];
  sales: AdminCustomerHistoryItem[] = [];

  isLoading = false;
  error: string | null = null;
  unlocking = false;
  deleting = false;
  historyTab: 'purchases' | 'sales' = 'purchases';

  ngOnInit(): void {
    this.customerId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.customerId) {
      this.error = 'Missing customer id.';
      return;
    }
    this.load();
  }

  load(): void {
    this.isLoading = true;
    this.error = null;
    this.adminService.getCustomerDetails(this.customerId).subscribe({
      next: (res) => {
        this.customer = res.customer;
        this.purchases = res.purchases ?? [];
        this.sales = res.sales ?? [];
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || err?.error?.error || 'Failed to load customer.';
        this.isLoading = false;
      },
    });
  }

  goBack(): void {
    void this.router.navigate(['/nexus/customers']);
  }

  initials(c: AdminCustomerDetails): string {
    return `${c.firstName?.[0] ?? ''}${c.lastName?.[0] ?? ''}`.toUpperCase() || '?';
  }

  avatarColor(c: AdminCustomerDetails): string {
    const palette = ['av-blue', 'av-purple', 'av-teal', 'av-amber', 'av-rose'];
    return palette[(c.firstName?.charCodeAt(0) ?? 0) % palette.length];
  }

  statusLabel(status: string): string {
    return (
      { active: 'Active', suspended: 'Suspended', closed: 'Closed' }[status] ?? status
    );
  }

  getStatusClass(status: string): string {
    return (
      { active: 'status-active', suspended: 'status-suspended', closed: 'status-closed' }[
        status
      ] ?? ''
    );
  }

  repScoreClass(score: number): string {
    if (score >= 80) return 'rep-high';
    if (score >= 50) return 'rep-mid';
    return 'rep-low';
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatMoney(amount: number | null | undefined): string {
    if (amount == null || Number.isNaN(amount)) return '—';
    return `€ ${amount.toLocaleString('pt-PT', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  txStatus(t: AdminCustomerHistoryItem): string {
    return t.transactionStatus || t.status || '—';
  }

  txStatusClass(t: AdminCustomerHistoryItem): string {
    const s = this.txStatus(t);
    if (s === 'completed' || s === 'paid' || s === 'delivered') return 'tx-ok';
    if (s === 'cancelled') return 'tx-bad';
    if (s === 'under_dispute') return 'tx-warn';
    return 'tx-muted';
  }

  counterparty(t: AdminCustomerHistoryItem, role: 'purchases' | 'sales'): string {
    const person = role === 'purchases' ? t.seller : t.buyer;
    if (!person) return '—';
    const name = `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim();
    return name || person.email || '—';
  }

  isContentRestricted(): boolean {
    const until = this.customer?.contentRestrictedUntil;
    return !!until && new Date(until) > new Date();
  }

  canUnlock(): boolean {
    return !!this.customer && this.isContentRestricted() && !this.unlocking && !this.deleting;
  }

  canDelete(): boolean {
    return (
      !!this.customer &&
      this.customer.accountStatus !== 'closed' &&
      !this.deleting &&
      !this.unlocking
    );
  }

  unlock(): void {
    if (!this.customer || !this.canUnlock()) return;
    const name = `${this.customer.firstName} ${this.customer.lastName}`.trim();
    if (
      !confirm(
        `Lift the content restriction for ${name}? They will be able to create and edit listings again immediately.`
      )
    ) {
      return;
    }
    this.unlocking = true;
    this.adminService.unlockContentRestriction(this.customer._id).subscribe({
      next: () => {
        if (this.customer) this.customer.contentRestrictedUntil = null;
        this.unlocking = false;
      },
      error: (err) => {
        alert(err?.error?.message || err?.error?.error || 'Failed to unlock.');
        this.unlocking = false;
      },
    });
  }

  deleteAccount(): void {
    if (!this.customer || !this.canDelete()) return;
    const name = `${this.customer.firstName} ${this.customer.lastName}`.trim();
    if (
      !confirm(
        `Permanently close the account for ${name} (${this.customer.email})?\n\nThis cannot be undone from Nexus.`
      )
    ) {
      return;
    }
    this.deleting = true;
    this.adminService.closeCustomer(this.customer._id, 'admin_close_from_nexus').subscribe({
      next: () => {
        if (this.customer) this.customer.accountStatus = 'closed';
        this.deleting = false;
      },
      error: (err) => {
        alert(err?.error?.message || err?.error?.error || 'Failed to close account.');
        this.deleting = false;
      },
    });
  }
}
