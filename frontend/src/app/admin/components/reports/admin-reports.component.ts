import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminReport } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-reports.component.html',
  styleUrls: ['./admin-reports.component.scss']
})
export class AdminReportsComponent implements OnInit {
  private adminService = inject(AdminService);

  reports: AdminReport[] = [];
  total = 0;
  isLoading = true;
  error: string | null = null;

  filterStatus = 'all';
  filterType = 'all';

  selectedReport: AdminReport | null = null;
  editStatus = 'pending';
  editNotes = '';
  saving = false;
  saveError: string | null = null;

  readonly STATUS_OPTIONS = ['all', 'pending', 'reviewed', 'resolved', 'dismissed'];
  readonly TYPE_OPTIONS = ['all', 'listing', 'user'];

  readonly REASON_LABELS: Record<string, string> = {
    fraud_scam: 'Fraud / Scam',
    offensive_content: 'Offensive content',
    prohibited_item: 'Prohibited item',
    spam: 'Spam',
    off_platform_transaction: 'Off-platform transaction',
    other: 'Other'
  };

  readonly STATUS_LABELS: Record<string, string> = {
    pending: 'Pending',
    reviewed: 'Reviewed',
    resolved: 'Resolved',
    dismissed: 'Dismissed'
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading = true;
    this.error = null;
    this.adminService.getReports({
      status: this.filterStatus,
      reportType: this.filterType,
      limit: 100
    }).subscribe({
      next: (res) => {
        this.reports = res.reports;
        this.total = res.total;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load reports';
        this.isLoading = false;
      }
    });
  }

  applyFilter(): void {
    this.load();
  }

  selectReport(report: AdminReport): void {
    this.selectedReport = report;
    this.editStatus = report.status;
    this.editNotes = report.adminNotes || '';
    this.saveError = null;
  }

  closeDetail(): void {
    this.selectedReport = null;
  }

  saveUpdate(): void {
    if (!this.selectedReport || this.saving) return;
    this.saving = true;
    this.saveError = null;
    this.adminService.updateReport(this.selectedReport._id, {
      status: this.editStatus,
      adminNotes: this.editNotes.trim() || undefined
    }).subscribe({
      next: (res) => {
        this.saving = false;
        const idx = this.reports.findIndex(r => r._id === res.report._id);
        if (idx !== -1) this.reports[idx] = res.report;
        this.closeDetail();
      },
      error: (err) => {
        this.saveError = err?.error?.error || 'Failed to save';
        this.saving = false;
      }
    });
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  reasonLabel(r: string): string {
    return this.REASON_LABELS[r] ?? r;
  }

  statusLabel(s: string): string {
    return this.STATUS_LABELS[s] ?? s;
  }
}
