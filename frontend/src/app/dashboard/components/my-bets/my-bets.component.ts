import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService } from '../../../shared/services/bids.service';

interface BetItem {
  _id: string;
  amount: number;
  createdAt: string;
  type: string;
  status: string;
}

interface EnhancedListing extends Listing {
  type?: string;
  bets?: BetItem[];
  notifyWhenOutbid?: boolean;
  isWinner?: boolean;
}

@Component({
  selector: 'app-my-bets',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './my-bets.component.html',
  styleUrls: ['./my-bets.component.scss']
})
export class MyBetsComponent implements OnInit {
  private listingsService = inject(ListingsService);
  private bidsService = inject(BidsService);

  listings: EnhancedListing[] = [];
  isLoading = true;
  error: string | null = null;
  expandedIds = new Set<string>();
  preferenceUpdating: Record<string, boolean> = {};

  ngOnInit(): void {
    this.loadMyBets();
  }

  loadMyBets(): void {
    this.isLoading = true;
    this.error = null;
    this.listingsService.getBidderBets().subscribe({
      next: (response) => {
        this.listings = (response.listings || []) as EnhancedListing[];
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Failed to load your bets';
        this.isLoading = false;
      }
    });
  }

  toggleExpanded(listing: EnhancedListing): void {
    const id = listing._id;
    if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
    } else {
      this.expandedIds.add(id);
    }
  }

  isExpanded(listing: EnhancedListing): boolean {
    return this.expandedIds.has(listing._id);
  }

  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'active': return 'badge-active';
      case 'ended': return 'badge-ended';
      case 'cancelled': return 'badge-cancelled';
      case 'draft': return 'badge-draft';
      default: return 'badge-default';
    }
  }

  getBetStatusClass(status: string): string {
    switch (status) {
      case 'accepted': return 'status-accepted';
      case 'rejected': return 'status-rejected';
      case 'pending': return 'status-pending';
      default: return 'status-default';
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

  onNotifyWhenOutbidChange(listing: EnhancedListing, checked: boolean): void {
    if (!listing._id || listing.isWinner) return;
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

  canShowNotifyToggle(listing: EnhancedListing): boolean {
    return !listing.isWinner && listing.status === 'active' && (listing.type === 'bid' || listing.type === 'mixed');
  }
}
