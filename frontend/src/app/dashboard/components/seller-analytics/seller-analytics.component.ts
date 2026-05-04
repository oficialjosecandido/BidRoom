import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ListingsService,
  SellerAnalyticsListingRow,
  SellerAnalyticsQueryParams,
  SellerAnalyticsResponse
} from '../../../shared/services/listings.service';

@Component({
  selector: 'app-seller-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, RouterLink],
  templateUrl: './seller-analytics.component.html',
  styleUrls: ['./seller-analytics.component.scss']
})
export class SellerAnalyticsComponent implements OnInit {
  private listingsService = inject(ListingsService);
  private destroyRef = inject(DestroyRef);
  /** Ignores stale HTTP responses when a newer reload was triggered. */
  private loadGeneration = 0;

  loading = true;
  error: string | null = null;

  data: SellerAnalyticsResponse | null = null;

  preset: '7d' | '30d' | 'custom' = '30d';
  customFrom = '';
  customTo = '';

  categoryFilter = '';
  listingFilter = '';

  listingOptions: { id: string; title: string }[] = [];

  ngOnInit(): void {
    this.listingsService
      .getMyListings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.listingOptions = (res.listings || []).map((l) => ({
            id: l._id,
            title: l.title?.length > 72 ? `${l.title.slice(0, 70)}…` : l.title
          }));
          this.reload();
        },
        error: () => {
          this.listingOptions = [];
          this.reload();
        }
      });
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

    const q: SellerAnalyticsQueryParams = { preset: this.preset };

    if (this.preset === 'custom') {
      const fromDt = new Date(`${this.customFrom.trim()}T00:00:00`);
      q.from = fromDt.toISOString();
      if (this.customTo.trim()) {
        q.to = new Date(`${this.customTo.trim()}T23:59:59.999`).toISOString();
      }
    }

    if (this.categoryFilter) q.category = this.categoryFilter;
    if (this.listingFilter) q.listingId = this.listingFilter;

    this.listingsService
      .getSellerAnalytics(q)
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

  statusLabel(row: SellerAnalyticsListingRow): string {
    switch (row.status) {
      case 'active':
        return 'dashboard.seller.analytics.statusActive';
      case 'ended':
        return 'dashboard.seller.analytics.statusEnded';
      case 'cancelled':
        return 'dashboard.seller.analytics.statusCancelled';
      case 'draft':
        return 'dashboard.seller.analytics.statusDraft';
      default:
        return row.status;
    }
  }

}
