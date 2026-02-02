import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ListingsService, Listing } from '../../../shared/services/listings.service';

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
  imports: [CommonModule, RouterLink],
  templateUrl: './my-auctions.component.html',
  styleUrls: ['./my-auctions.component.scss']
})
export class MyAuctionsComponent implements OnInit {
  listings: EnhancedListing[] = [];
  isLoading = true;
  error: string | null = null;

  constructor(private listingsService: ListingsService) {}

  ngOnInit(): void {
    this.loadMyListings();
  }

  loadMyListings(): void {
    this.isLoading = true;
    this.error = null;

    this.listingsService.getMyListings().subscribe({
      next: (response) => {
        this.listings = response.listings as EnhancedListing[];
        this.isLoading = false;
      },
      error: (error) => {
        this.error = error?.message || 'Failed to load your listings';
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

