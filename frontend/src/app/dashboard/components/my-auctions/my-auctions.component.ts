import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { SocketService } from '../../../shared/services/socket.service';

interface PlatinumBidderStatus {
  bidder: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  status: 'pending' | 'accepted' | 'declined';
  invitedAt: string;
  acceptedAt?: string | null;
}

interface EnhancedListing extends Listing {
  platinumBidderStatus?: PlatinumBidderStatus[];
}

@Component({
  selector: 'app-my-auctions',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './my-auctions.component.html',
  styleUrls: ['./my-auctions.component.scss']
})
export class MyAuctionsComponent implements OnInit, OnDestroy {
  private listingsService = inject(ListingsService);
  private socketService = inject(SocketService);

  listings: EnhancedListing[] = [];
  isLoading = true;
  error: string | null = null;

  private socketSubscriptions: Subscription[] = [];
  private joinedListingIds: string[] = [];
  private destroyed = false;

  ngOnInit(): void {
    this.loadMyListings();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cleanupRealTime();
  }

  loadMyListings(): void {
    this.isLoading = true;
    this.error = null;

    this.listingsService.getMyListings().subscribe({
      next: (response) => {
        this.listings = response.listings as EnhancedListing[];
        this.isLoading = false;
        this.setupRealTimeUpdates();
      },
      error: (error) => {
        this.error = error?.message || 'Failed to load your listings';
        this.isLoading = false;
      }
    });
  }

  private setupRealTimeUpdates(): void {
    if (this.destroyed) return;
    this.cleanupRealTime();

    const now = new Date();
    const activeIds = this.listings
      .filter(l => l.status === 'active' && new Date(l.endDate) > now)
      .map(l => l._id)
      .filter(Boolean) as string[];

    if (!activeIds.length) return;

    this.joinedListingIds = activeIds;
    this.socketService.connect();
    this.socketService.joinListings(activeIds);

    const newBidSub = this.socketService.onNewBid().subscribe((event) => {
      const listing = this.listings.find(l => l._id === event.listingId);
      if (listing && event.bidCount !== undefined) {
        listing.bidCount = event.bidCount;
        if (event.currentPrice !== undefined) listing.currentPrice = event.currentPrice;
      }
    });
    this.socketSubscriptions.push(newBidSub);

    const updateSub = this.socketService.onListingUpdate().subscribe((event) => {
      const listing = this.listings.find(l => l._id === event.listingId);
      if (listing) {
        if (event.bidCount !== undefined) listing.bidCount = event.bidCount;
        if (event.currentPrice !== undefined) listing.currentPrice = event.currentPrice;
        if (event.status) listing.status = event.status;
      }
    });
    this.socketSubscriptions.push(updateSub);
  }

  private cleanupRealTime(): void {
    for (const sub of this.socketSubscriptions) sub.unsubscribe();
    this.socketSubscriptions = [];
    if (this.joinedListingIds.length) {
      this.socketService.leaveListings(this.joinedListingIds);
      this.joinedListingIds = [];
    }
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

  getPlatinumStatusCounts(listing: EnhancedListing): { pending: number; accepted: number; declined: number } {
    if (!listing.platinumBidderStatus || listing.platinumBidderStatus.length === 0) {
      return { pending: 0, accepted: 0, declined: 0 };
    }

    return listing.platinumBidderStatus.reduce((counts, status) => {
      counts[status.status as 'pending' | 'accepted' | 'declined']++;
      return counts;
    }, { pending: 0, accepted: 0, declined: 0 });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

