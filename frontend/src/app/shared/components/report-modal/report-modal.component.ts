import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ReportService, ReportType, ReportReason } from '../../services/report.service';

@Component({
  selector: 'app-report-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './report-modal.component.html',
  styleUrls: ['./report-modal.component.scss']
})
export class ReportModalComponent {
  @Input() reportType!: ReportType;
  @Input() targetId!: string;
  @Input() targetName = '';
  @Output() closed = new EventEmitter<void>();

  private reportService = inject(ReportService);

  readonly reasons: ReportReason[] = [
    'fraud_scam',
    'offensive_content',
    'prohibited_item',
    'spam',
    'off_platform_transaction',
    'other'
  ];

  selectedReason = signal<ReportReason | null>(null);
  description = signal('');
  submitting = signal(false);
  submitted = signal(false);
  error = signal('');

  selectReason(reason: ReportReason) {
    this.selectedReason.set(reason);
    this.error.set('');
  }

  submit() {
    if (!this.selectedReason()) {
      this.error.set('report.errors.selectReason');
      return;
    }
    this.submitting.set(true);
    this.error.set('');

    this.reportService.createReport({
      reportType: this.reportType,
      targetId: this.targetId,
      reason: this.selectedReason()!,
      description: this.description() || undefined
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
      },
      error: (err) => {
        this.submitting.set(false);
        if (err.status === 409) {
          this.error.set('report.errors.alreadyReported');
        } else {
          this.error.set('report.errors.generic');
        }
      }
    });
  }

  close() {
    this.closed.emit();
  }
}
