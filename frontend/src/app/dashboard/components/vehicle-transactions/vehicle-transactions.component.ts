import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import Swal from 'sweetalert2';
import {
  VehicleTransactionService,
  VehicleTransaction,
  VtStatus,
  AuthorizeResult
} from '../../../shared/services/vehicle-transaction.service';

@Component({
  selector: 'app-vehicle-transactions',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './vehicle-transactions.component.html',
  styleUrls: ['./vehicle-transactions.component.scss'],
})
export class VehicleTransactionsComponent implements OnInit {
  private vtService = inject(VehicleTransactionService);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);

  vt: VehicleTransaction | null = null;
  isLoading = true;
  error: string | null = null;

  actionLoading = false;
  actionError: string | null = null;

  get isBuyer(): boolean {
    return this.vt?.role === 'buyer';
  }

  get isSeller(): boolean {
    return this.vt?.role === 'seller';
  }

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      const vtId = params['id'];
      if (vtId) this.loadVt(vtId);
    });
  }

  loadVt(vtId: string): void {
    this.isLoading = true;
    this.error = null;
    this.vtService.get(vtId).subscribe({
      next: (vt) => { this.vt = vt; this.isLoading = false; },
      error: (err) => {
        this.error = err?.error?.error || this.translate.instant('vehicleTransaction.loadError');
        this.isLoading = false;
      },
    });
  }

  // ── Status helpers ────────────────────────────────────────────────────────

  statusLabel(s: VtStatus): string {
    const map: Record<VtStatus, string> = {
      awaiting_setup: this.translate.instant('vehicleTransaction.status.awaiting_setup'),
      in_progress: this.translate.instant('vehicleTransaction.status.in_progress'),
      awaiting_confirmation: this.translate.instant('vehicleTransaction.status.awaiting_confirmation'),
      completed: this.translate.instant('vehicleTransaction.status.completed'),
      failed: this.translate.instant('vehicleTransaction.status.failed'),
      cancelled: this.translate.instant('vehicleTransaction.status.cancelled'),
    };
    return map[s] ?? s;
  }

  countdownTo(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const ms = new Date(dateStr).getTime() - Date.now();
    if (ms <= 0) return this.translate.instant('vehicleTransaction.deadlinePassed');
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h >= 24) return this.translate.instant('vehicleTransaction.daysLeft', { count: Math.floor(h / 24) });
    return this.translate.instant('vehicleTransaction.hoursLeft', { h, m });
  }

  needsBuyerDeposit(): boolean {
    return this.isBuyer &&
      this.vt?.status === 'awaiting_setup' &&
      (this.vt?.deposit?.status === 'pending' || this.vt?.deposit?.status === 'failed');
  }

  needsSellerFee(): boolean {
    return this.isSeller &&
      this.vt?.status === 'awaiting_setup' &&
      (this.vt?.sellerFee?.status === 'pending' || this.vt?.sellerFee?.status === 'failed');
  }

  canConfirmCompletion(): boolean {
    if (!this.vt) return false;
    if (!['in_progress', 'awaiting_confirmation'].includes(this.vt.status)) return false;
    if (this.isBuyer && this.vt.completion.buyerConfirmed) return false;
    if (this.isSeller && this.vt.completion.sellerConfirmed) return false;
    return true;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  runAuthorizeDeposit(): void {
    if (!this.vt) return;
    this.actionLoading = true;
    this.actionError = null;
    this.vtService.authorizeDeposit(this.vt._id).subscribe({
      next: (res: AuthorizeResult) => {
        this.actionLoading = false;
        if (res.status === 'authorized') {
          this.vt!.deposit.status = 'authorized';
        } else if (res.status === 'requires_action') {
          // 3DS needed — reload so user sees the requires_action state
          this.vt!.deposit.status = 'requires_action';
          this.actionError = this.translate.instant('vehicleTransaction.depositRequires3ds');
        } else if (res.status === 'no_payment_method') {
          this.actionError = this.translate.instant('vehicleTransaction.noPaymentMethod');
        } else {
          this.actionError = this.translate.instant('vehicleTransaction.depositFailed');
        }
      },
      error: () => {
        this.actionLoading = false;
        this.actionError = this.translate.instant('vehicleTransaction.depositFailed');
      },
    });
  }

  runPayFee(): void {
    if (!this.vt) return;
    this.actionLoading = true;
    this.actionError = null;
    this.vtService.payFee(this.vt._id).subscribe({
      next: (res: AuthorizeResult) => {
        this.actionLoading = false;
        if (res.status === 'paid') {
          this.vt!.sellerFee.status = 'paid';
        } else if (res.status === 'requires_action') {
          this.vt!.sellerFee.status = 'requires_action';
          this.actionError = this.translate.instant('vehicleTransaction.feeRequires3ds');
        } else if (res.status === 'no_payment_method') {
          this.actionError = this.translate.instant('vehicleTransaction.noPaymentMethod');
        } else {
          this.actionError = this.translate.instant('vehicleTransaction.feeFailed');
        }
      },
      error: () => {
        this.actionLoading = false;
        this.actionError = this.translate.instant('vehicleTransaction.feeFailed');
      },
    });
  }

  runConfirmCompletion(): void {
    if (!this.vt) return;
    Swal.fire({
      title: this.translate.instant('vehicleTransaction.confirmCompletionTitle'),
      text: this.translate.instant('vehicleTransaction.confirmCompletionText'),
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: this.translate.instant('vehicleTransaction.confirm'),
      cancelButtonText: this.translate.instant('vehicleTransaction.cancel'),
    }).then(result => {
      if (!result.isConfirmed) return;
      this.actionLoading = true;
      this.actionError = null;
      this.vtService.confirmCompletion(this.vt!._id).subscribe({
        next: () => {
          this.actionLoading = false;
          this.loadVt(this.vt!._id);
        },
        error: () => {
          this.actionLoading = false;
          this.actionError = this.translate.instant('vehicleTransaction.confirmFailed');
        },
      });
    });
  }
}
