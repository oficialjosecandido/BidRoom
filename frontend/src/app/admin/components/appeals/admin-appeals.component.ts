import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { API_CONFIG } from '../../../shared/config/api.config';

interface AppealUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  accountStatus: string;
  contentViolationCount?: number;
  contentRestrictedUntil?: string | null;
}

interface Appeal {
  _id: string;
  user: AppealUser;
  restrictionType: 'content_restriction' | 'suspended' | 'other';
  restrictedUntil: string | null;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  adminResponse: string;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

@Component({
  selector: 'app-admin-appeals',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-appeals.component.html',
  styleUrls: ['./admin-appeals.component.scss']
})
export class AdminAppealsComponent implements OnInit {
  private http = inject(HttpClient);

  appeals: Appeal[] = [];
  isLoading = false;
  error: string | null = null;
  selectedStatus = 'pending';
  reviewingId: string | null = null;
  adminResponseText = '';
  reviewError = '';

  readonly statuses = [
    { value: 'pending',  label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'all',      label: 'All' },
  ];

  private get apiUrl(): string {
    return `${API_CONFIG.getApiUrl()}/appeals/admin`;
  }

  ngOnInit(): void { this.load(); }

  load(): void {
    this.isLoading = true;
    this.error = null;
    this.http.get<{ appeals: Appeal[] }>(`${this.apiUrl}?status=${this.selectedStatus}`).subscribe({
      next: (res) => { this.appeals = res.appeals ?? []; this.isLoading = false; },
      error: (err) => { this.error = err?.error?.message || 'Failed to load appeals'; this.isLoading = false; }
    });
  }

  startReview(appeal: Appeal): void {
    this.reviewingId = appeal._id;
    this.adminResponseText = '';
    this.reviewError = '';
  }

  cancelReview(): void {
    this.reviewingId = null;
    this.adminResponseText = '';
    this.reviewError = '';
  }

  decide(appealId: string, decision: 'approved' | 'rejected'): void {
    this.reviewError = '';
    this.http.patch<{ success: boolean; appeal: Appeal }>(
      `${this.apiUrl}/${appealId}`,
      { decision, adminResponse: this.adminResponseText.trim() }
    ).subscribe({
      next: ({ appeal }) => {
        const idx = this.appeals.findIndex(a => a._id === appealId);
        if (idx !== -1) this.appeals[idx] = appeal;
        this.reviewingId = null;
        this.adminResponseText = '';
        if (this.selectedStatus !== 'all' && this.selectedStatus !== decision) {
          this.appeals = this.appeals.filter(a => a._id !== appealId);
        }
      },
      error: (err) => { this.reviewError = err?.error?.message || 'Failed to process appeal.'; }
    });
  }

  formatDate(d: string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('pt-PT', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  statusClass(s: string): string {
    return { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected' }[s] ?? '';
  }
}
