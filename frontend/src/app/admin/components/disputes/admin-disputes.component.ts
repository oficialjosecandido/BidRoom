import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { Transaction } from '../../../shared/services/transactions.service';

@Component({
  selector: 'app-admin-disputes',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-disputes.component.html',
  styleUrls: ['./admin-disputes.component.scss']
})
export class AdminDisputesComponent implements OnInit {
  private adminService = inject(AdminService);

  disputes: (Transaction & { disputeAgeHours?: number; disputeAgeDays?: number })[] = [];
  selectedDispute: Transaction | null = null;
  isLoading = true;
  error: string | null = null;
  rulingVerdict: 'buyer_refund' | 'seller_payout' | 'partial_refund' = 'buyer_refund';
  rulingRefundAmount = 0;
  rulingAdminNotes = '';
  rulingSubmitting = false;
  rulingError: string | null = null;

  readonly DISPUTE_REASON_LABELS: Record<string, string> = {
    item_not_as_described: 'Item not as described',
    damaged_in_transit: 'Damaged in transit',
    missing_parts: 'Missing parts',
    counterfeit: 'Counterfeit',
    other: 'Other'
  };

  ngOnInit(): void {
    this.loadDisputes();
  }

  loadDisputes(): void {
    this.isLoading = true;
    this.error = null;
    this.adminService.getDisputes().subscribe({
      next: (res) => {
        this.disputes = res.disputes ?? [];
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load disputes';
        this.isLoading = false;
      }
    });
  }

  selectDispute(transactionId: string): void {
    this.selectedDispute = null;
    this.rulingError = null;
    this.adminService.getDispute(transactionId).subscribe({
      next: (d) => {
        this.selectedDispute = d;
        this.rulingVerdict = 'buyer_refund';
        this.rulingRefundAmount = d.amount ?? 0;
        this.rulingAdminNotes = '';
      },
      error: (err) => {
        this.rulingError = err?.error?.message || 'Failed to load dispute';
      }
    });
  }

  closeDisputeDetail(): void {
    this.selectedDispute = null;
  }

  formatPrice(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  getDisputeReasonLabel(code: string): string {
    return this.DISPUTE_REASON_LABELS[code] ?? code;
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  submitRuling(): void {
    const d = this.selectedDispute;
    if (!d || this.rulingSubmitting) return;
    const payload: { verdict: 'buyer_refund' | 'seller_payout' | 'partial_refund'; refundAmount?: number; adminNotes?: string } = {
      verdict: this.rulingVerdict,
      adminNotes: this.rulingAdminNotes.trim() || undefined
    };
    if (this.rulingVerdict === 'partial_refund') {
      payload.refundAmount = this.rulingRefundAmount;
    }
    this.rulingSubmitting = true;
    this.rulingError = null;
    this.adminService.issueDisputeRuling(d._id, payload).subscribe({
      next: () => {
        this.rulingSubmitting = false;
        this.closeDisputeDetail();
        this.loadDisputes();
      },
      error: (err) => {
        this.rulingError = err?.error?.message || 'Failed to issue ruling';
        this.rulingSubmitting = false;
      }
    });
  }
}
