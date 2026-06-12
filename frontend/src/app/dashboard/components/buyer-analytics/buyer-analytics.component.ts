import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ListingsService,
  BuyerAnalyticsListingRow,
  BuyerAnalyticsQueryParams,
  BuyerAnalyticsResponse
} from '../../../shared/services/listings.service';

@Component({
  selector: 'app-buyer-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, RouterLink],
  templateUrl: './buyer-analytics.component.html',
  styleUrls: ['../seller-analytics/seller-analytics.component.scss']
})
export class BuyerAnalyticsComponent implements OnInit {
  private listingsService = inject(ListingsService);
  private destroyRef = inject(DestroyRef);
  private loadGeneration = 0;

  loading = true;
  error: string | null = null;
  data: BuyerAnalyticsResponse | null = null;

  preset: '7d' | '30d' | 'custom' = '30d';
  customFrom = '';
  customTo = '';
  categoryFilter = '';
  interactionFilter: 'all' | 'bid' | 'offer' = 'all';

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.error = null;

    if (this.preset === 'custom' && !this.customFrom.trim()) {
      this.loading = false;
      this.error = 'analyticsCustomFromRequired';
      return;
    }

    const requestGen = ++this.loadGeneration;
    this.loading = true;

    const q: BuyerAnalyticsQueryParams = { preset: this.preset, interaction: this.interactionFilter };

    if (this.preset === 'custom') {
      const fromDt = new Date(`${this.customFrom.trim()}T00:00:00`);
      q.from = fromDt.toISOString();
      if (this.customTo.trim()) {
        q.to = new Date(`${this.customTo.trim()}T23:59:59.999`).toISOString();
      }
    }

    if (this.categoryFilter) q.category = this.categoryFilter;

    this.listingsService
      .getBuyerAnalytics(q)
      .pipe(
        finalize(() => {
          if (requestGen === this.loadGeneration) {
            this.loading = false;
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (d) => {
          if (requestGen !== this.loadGeneration) return;
          this.data = d;
          this.error = null;
        },
        error: () => {
          if (requestGen !== this.loadGeneration) return;
          this.error = 'loadFailed';
          if (!this.data) {
            this.data = null;
          }
        }
      });
  }

  setPreset(p: '7d' | '30d' | 'custom'): void {
    if (this.preset === p) return;
    this.preset = p;
    this.reload();
  }

  applyFilters(): void {
    if (this.preset === 'custom' && !this.customFrom.trim()) {
      this.error = 'analyticsCustomFromRequired';
      return;
    }
    this.error = null;
    this.reload();
  }

  statusLabel(row: BuyerAnalyticsListingRow): string {
    switch (row.status) {
      case 'active':
        return 'dashboard.buyer.analytics.statusActive';
      case 'ended':
        return 'dashboard.buyer.analytics.statusEnded';
      case 'cancelled':
        return 'dashboard.buyer.analytics.statusCancelled';
      default:
        return row.status;
    }
  }

  outcomeLabel(row: BuyerAnalyticsListingRow): string {
    const key = `dashboard.buyer.analytics.outcome.${row.outcome}`;
    return key;
  }

  formatMoney(amount: number): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(amount);
  }
}
