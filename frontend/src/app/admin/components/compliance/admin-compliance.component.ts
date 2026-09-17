import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminComplianceFlag } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

/**
 * The review queue for vehicle-compliance and AML flags.
 *
 * None of these flags blocked anything — they exist so a person decides. What
 * the reviewer does about a confirmed one (reclassify a seller, restrict an
 * account) happens in Customers, deliberately: resolving here records the
 * decision, it does not silently act on the account.
 */
@Component({
  selector: 'app-admin-compliance',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-compliance.component.html',
  styleUrls: ['./admin-compliance.component.scss']
})
export class AdminComplianceComponent implements OnInit {
  private adminService = inject(AdminService);

  flags: AdminComplianceFlag[] = [];
  total = 0;
  isLoading = true;
  error: string | null = null;

  filterType = 'all';
  showResolved = false;

  selectedFlag: AdminComplianceFlag | null = null;
  resolutionNote = '';
  saving = false;
  saveError: string | null = null;

  readonly TYPE_OPTIONS = ['all', 'undeclared_professional', 'aml_repeat_winner', 'aml_new_seller_high_value'];

  readonly TYPE_LABELS: Record<string, string> = {
    undeclared_professional: 'Possible undeclared trader',
    aml_repeat_winner: 'Repeat vehicle buyer',
    aml_new_seller_high_value: 'New seller, high value'
  };

  /** What the reviewer is actually being asked to decide, per flag type. */
  readonly TYPE_QUESTIONS: Record<string, string> = {
    undeclared_professional:
      'Is this seller trading professionally? If so, they owe buyers the consumer warranty under DL 84/2021 and must be reclassified.',
    aml_repeat_winner:
      'Does this buyer have a legitimate reason to be winning vehicles repeatedly (e.g. a dealer)? If so, they should be declared professional.',
    aml_new_seller_high_value:
      'Is there anything else unusual about this account beyond being new? On its own, being new is not suspicious.'
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading = true;
    this.error = null;
    this.adminService.getComplianceFlags({
      resolved: this.showResolved,
      type: this.filterType,
      limit: 100
    }).subscribe({
      next: (res) => {
        this.flags = res.flags;
        this.total = res.total;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load compliance flags';
        this.isLoading = false;
      }
    });
  }

  applyFilter(): void {
    this.load();
  }

  selectFlag(flag: AdminComplianceFlag): void {
    this.selectedFlag = flag;
    this.resolutionNote = flag.resolutionNote || '';
    this.saveError = null;
  }

  closeDetail(): void {
    this.selectedFlag = null;
  }

  resolve(): void {
    if (!this.selectedFlag || this.saving) return;
    const note = this.resolutionNote.trim();
    if (!note) {
      this.saveError = 'Record what you concluded before closing the flag.';
      return;
    }
    this.saving = true;
    this.saveError = null;
    this.adminService.resolveComplianceFlag(this.selectedFlag._id, note).subscribe({
      next: () => {
        this.saving = false;
        this.closeDetail();
        // The list is filtered by resolved state, so the row belongs in the
        // other view now — reload rather than patch it in place.
        this.load();
      },
      error: (err) => {
        this.saveError = err?.error?.message || err?.error?.error || 'Failed to resolve';
        this.saving = false;
      }
    });
  }

  /** `details` is free-form per flag type, so it is rendered as key/value rows. */
  detailRows(flag: AdminComplianceFlag): { key: string; value: string }[] {
    return Object.entries(flag.details || {}).map(([key, value]) => ({
      key: key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()),
      value: String(value)
    }));
  }

  typeLabel(t: string): string {
    return this.TYPE_LABELS[t] ?? t;
  }

  typeQuestion(t: string): string {
    return this.TYPE_QUESTIONS[t] ?? '';
  }

  sellerName(flag: AdminComplianceFlag): string {
    if (!flag.userId) return '—';
    return `${flag.userId.firstName} ${flag.userId.lastName}`.trim() || '—';
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }
}
