import { Component, OnInit, inject } from '@angular/core';

import { RouterLink } from '@angular/router';
import { WatchlistService } from '../../../shared/services/watchlist.service';
import { Listing } from '../../../shared/services/listings.service';

@Component({
  selector: 'app-dashboard-watchlist',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard-watchlist.component.html',
  styleUrls: ['./dashboard-watchlist.component.scss']
})
export class DashboardWatchlistComponent implements OnInit {
  private watchlistService = inject(WatchlistService);

  watchlist: Listing[] = [];
  isLoading = true;
  error: string | null = null;
  removingId: string | null = null;

  ngOnInit(): void {
    this.loadWatchlist();
  }

  loadWatchlist(): void {
    this.isLoading = true;
    this.error = null;

    this.watchlistService.getMyWatchlist().subscribe({
      next: (response) => {
        this.watchlist = response.watchlist || [];
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Failed to load watchlist';
        this.isLoading = false;
      }
    });
  }

  removeFromWatchlist(listing: Listing): void {
    if (!listing._id || this.removingId) return;
    this.removingId = listing._id;
    this.watchlistService.remove(listing._id).subscribe({
      next: () => {
        this.watchlist = this.watchlist.filter((l) => l._id !== listing._id);
        this.removingId = null;
      },
      error: () => {
        this.removingId = null;
      }
    });
  }

  formatPrice(price: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(price);
  }

  getImage(listing: Listing): string {
    const img = listing.images?.[0];
    return img || 'https://via.placeholder.com/400x300?text=No+Image';
  }
}
