import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminCustomer } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-customers.component.html',
  styleUrls: ['./admin-customers.component.scss']
})
export class AdminCustomersComponent implements OnInit {
  private adminService = inject(AdminService);

  customers: AdminCustomer[] = [];
  isLoading = false;
  error: string | null = null;

  page = 1;
  readonly pageSize = 25;
  total = 0;
  totalPages = 0;

  searchQuery = '';
  selectedStatus = 'all';

  statuses = [
    { value: 'all',       label: 'All statuses' },
    { value: 'active',    label: 'Active' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'closed',    label: 'Closed' }
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading = true;
    this.error = null;
    this.adminService.getCustomers({
      page: this.page,
      limit: this.pageSize,
      q: this.searchQuery.trim() || undefined,
      status: this.selectedStatus
    }).subscribe({
      next: (res) => {
        this.customers  = res.customers ?? [];
        this.total      = res.total ?? 0;
        this.totalPages = Math.max(1, res.pages ?? 1);
        this.page       = Math.max(1, Math.min(res.page ?? 1, this.totalPages));
        this.isLoading  = false;
      },
      error: (err) => {
        this.error     = err?.error?.message || 'Failed to load customers';
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
    return { active: 'status-active', suspended: 'status-suspended', closed: 'status-closed' }[status] ?? '';
  }

  statusLabel(status: string): string {
    return this.statuses.find(s => s.value === status)?.label ?? status;
  }

  initials(c: AdminCustomer): string {
    return `${c.firstName?.[0] ?? ''}${c.lastName?.[0] ?? ''}`.toUpperCase();
  }

  avatarColor(c: AdminCustomer): string {
    const palette = ['av-blue', 'av-purple', 'av-teal', 'av-amber', 'av-rose'];
    return palette[(c.firstName?.charCodeAt(0) ?? 0) % palette.length];
  }

  repScoreClass(score: number): string {
    if (score >= 80) return 'rep-high';
    if (score >= 50) return 'rep-mid';
    return 'rep-low';
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
