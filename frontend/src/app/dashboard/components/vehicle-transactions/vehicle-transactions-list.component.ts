import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { VehicleTransactionService, VehicleTransaction, VtStatus } from '../../../shared/services/vehicle-transaction.service';

@Component({
  selector: 'app-vehicle-transactions-list',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  template: `
<div class="vtl-page">
  <h1 class="vtl-title">{{ 'dashboard.sidebar.vehicleTransactions' | translate }}</h1>

  @if (isLoading) {
    <div class="vtl-loading"><div class="spinner"></div></div>
  }
  @if (error) {
    <p class="vtl-error">{{ error }}</p>
  }
  @if (!isLoading && !error && items.length === 0) {
    <p class="vtl-empty">{{ 'vehicleTransaction.noTransactions' | translate }}</p>
  }
  @for (vt of items; track vt._id) {
    <a class="vtl-card" [routerLink]="['/dashboard/vehicle-transactions', vt._id]">
      @if (vt.listing?.images?.[0]) {
        <img class="vtl-card__thumb" [src]="vt.listing!.images![0]" [alt]="vt.listing!.title" />
      }
      <div class="vtl-card__body">
        <p class="vtl-card__title">{{ vt.listing?.title }}</p>
        <p class="vtl-card__price">€{{ vt.agreedPrice | number:'1.2-2' }}</p>
        <p class="vtl-card__role">{{ roleLabel(vt.role!) }}</p>
      </div>
      <span class="vtl-card__badge" [class]="'vtl-badge--' + vt.status">{{ statusLabel(vt.status!) }}</span>
    </a>
  }
</div>
  `,
  styles: [`
.vtl-page { max-width: 680px; margin: 0 auto; padding: 24px 16px 64px; }
.vtl-title { font-size: 20px; font-weight: 700; margin: 0 0 20px; color: var(--color-text, #0f172a); }
.vtl-loading { display: flex; justify-content: center; padding: 40px 0; }
.vtl-error, .vtl-empty { color: #64748b; font-size: 14px; padding: 16px 0; }
.vtl-error { color: #dc2626; }
.vtl-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px; margin-bottom: 10px; text-decoration: none;
  background: var(--surface, #fff); transition: border-color 0.15s;
  &:hover { border-color: var(--color-primary, #0ea5e9); }
  &__thumb { width: 60px; height: 48px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
  &__body { flex: 1; min-width: 0; }
  &__title { font-size: 14px; font-weight: 600; color: #0f172a; margin: 0 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__price { font-size: 15px; font-weight: 700; color: var(--color-primary, #0ea5e9); margin: 0 0 2px; }
  &__role { font-size: 12px; color: #64748b; margin: 0; text-transform: uppercase; }
  &__badge {
    flex-shrink: 0; padding: 3px 10px; border-radius: 9999px; font-size: 11px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  }
}
.vtl-badge--awaiting_setup    { background: #fef3c7; color: #92400e; }
.vtl-badge--in_progress       { background: #dbeafe; color: #1e40af; }
.vtl-badge--awaiting_confirmation { background: #e0e7ff; color: #3730a3; }
.vtl-badge--completed         { background: #dcfce7; color: #166534; }
.vtl-badge--failed            { background: #fee2e2; color: #991b1b; }
.vtl-badge--cancelled         { background: #f1f5f9; color: #475569; }
.spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top-color: var(--color-primary, #0ea5e9); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class VehicleTransactionsListComponent implements OnInit {
  private vtService = inject(VehicleTransactionService);
  private translate = inject(TranslateService);

  items: Partial<VehicleTransaction>[] = [];
  isLoading = true;
  error: string | null = null;

  ngOnInit(): void {
    this.vtService.getAll().subscribe({
      next: (res) => { this.items = res.vehicleTransactions; this.isLoading = false; },
      error: () => {
        this.error = this.translate.instant('vehicleTransaction.loadError');
        this.isLoading = false;
      },
    });
  }

  statusLabel(s: VtStatus): string {
    return this.translate.instant(`vehicleTransaction.status.${s}`);
  }

  roleLabel(role: 'buyer' | 'seller'): string {
    return this.translate.instant(`vehicleTransaction.${role}`);
  }
}
