import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ListingsService,
  BuyerAnalyticsResponse,
  SellerAnalyticsResponse
} from '../../../shared/services/listings.service';
import { SellerAnalyticsComponent } from '../seller-analytics/seller-analytics.component';
import { BuyerAnalyticsComponent } from '../buyer-analytics/buyer-analytics.component';

type AnalyticsMode = 'overview' | 'seller' | 'buyer';

@Component({
  selector: 'app-dashboard-analytics',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    SellerAnalyticsComponent,
    BuyerAnalyticsComponent
  ],
  templateUrl: './dashboard-analytics.component.html',
  styleUrls: ['./dashboard-analytics.component.scss']
})
export class DashboardAnalyticsComponent implements OnInit {
  private listingsService = inject(ListingsService);
  private destroyRef = inject(DestroyRef);
  private loadGeneration = 0;

  mode: AnalyticsMode = 'overview';
  preset: '7d' | '30d' | 'custom' = '30d';
  customFrom = '';
  customTo = '';

  loading = true;
  error: string | null = null;
  sellerOverview: SellerAnalyticsResponse | null = null;
  buyerOverview: BuyerAnalyticsResponse | null = null;

  ngOnInit(): void {
    this.reloadOverview();
  }

  setMode(m: AnalyticsMode): void {
    if (this.mode === m) return;
    this.mode = m;
    if (m === 'overview') {
      this.reloadOverview();
    }
  }

  setPreset(p: '7d' | '30d' | 'custom'): void {
    if (this.preset === p) return;
    this.preset = p;
    if (this.mode === 'overview') {
      this.reloadOverview();
    }
  }

  applyOverviewFilters(): void {
    if (this.preset === 'custom' && !this.customFrom.trim()) {
      this.error = 'analyticsCustomFromRequired';
      return;
    }
    this.reloadOverview();
  }

  reloadOverview(): void {
    this.error = null;

    if (this.preset === 'custom' && !this.customFrom.trim()) {
      this.loading = false;
      this.error = 'analyticsCustomFromRequired';
      return;
    }

    const requestGen = ++this.loadGeneration;
    this.loading = true;

    const params: { preset: '7d' | '30d' | 'custom'; from?: string; to?: string } = { preset: this.preset };
    if (this.preset === 'custom') {
      params.from = new Date(`${this.customFrom.trim()}T00:00:00`).toISOString();
      if (this.customTo.trim()) {
        params.to = new Date(`${this.customTo.trim()}T23:59:59.999`).toISOString();
      }
    }

    forkJoin({
      seller: this.listingsService.getSellerAnalytics(params),
      buyer: this.listingsService.getBuyerAnalytics({ ...params, interaction: 'all' })
    })
      .pipe(
        finalize(() => {
          if (requestGen === this.loadGeneration) {
            this.loading = false;
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ seller, buyer }) => {
          if (requestGen !== this.loadGeneration) return;
          this.sellerOverview = seller;
          this.buyerOverview = buyer;
          this.error = null;
        },
        error: () => {
          if (requestGen !== this.loadGeneration) return;
          this.error = 'loadFailed';
        }
      });
  }

  formatMoney(amount: number): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(amount);
  }
}
