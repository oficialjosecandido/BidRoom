import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService } from '../../../shared/services/bids.service';

@Component({
  selector: 'app-my-auctions-bidder',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './my-auctions-bidder.component.html',
  styleUrls: ['./my-auctions-bidder.component.scss']
})
export class MyAuctionsBidderComponent implements OnInit {
  private listingsService = inject(ListingsService);
  private bidsService = inject(BidsService);

  listings: Listing[] = [];
  isLoading = true;
  error: string | null = null;
  preferenceUpdating: Record<string, boolean> = {};

  ngOnInit(): void {
    this.loadMyAuctions();
  }

  loadMyAuctions(): void {
    this.isLoading = true;
    this.error = null;

    this.listingsService.getBidderAuctions().subscribe({
      next: (response) => {
        this.listings = response.listings || [];
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Failed to load your auctions';
        this.isLoading = false;
      }
    });
  }

  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'active':
        return 'badge-active';
      case 'ended':
        return 'badge-ended';
      case 'cancelled':
        return 'badge-cancelled';
      case 'draft':
        return 'badge-draft';
      default:
        return 'badge-default';
    }
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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

  onNotifyWhenOutbidChange(listing: Listing, checked: boolean): void {
    if (!listing._id) return;
    this.preferenceUpdating[listing._id] = true;
    this.bidsService.updateBidderPreference(listing._id, checked).subscribe({
      next: () => {
        listing.notifyWhenOutbid = checked;
        this.preferenceUpdating[listing._id] = false;
      },
      error: () => {
        this.preferenceUpdating[listing._id] = false;
      }
    });
  }
}
