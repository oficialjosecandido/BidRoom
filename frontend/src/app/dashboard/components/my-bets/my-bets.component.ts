import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService } from '../../../shared/services/bids.service';
import { OffersService } from '../../../shared/services/offers.service';

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
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './my-bets.component.html',
  styleUrls: ['./my-bets.component.scss']
})
export class MyBetsComponent implements OnInit {
  private listingsService = inject(ListingsService);
  private bidsService = inject(BidsService);
  private offersService = inject(OffersService);
  private translate = inject(TranslateService);

  listings: EnhancedListing[] = [];
  isLoading = true;
  error: string | null = null;
  expandedIds = new Set<string>();
  preferenceUpdating: Record<string, boolean> = {};
  withdrawingId: string | null = null;
  bidFilter: 'all' | 'winning' | 'outbid' | 'ended' = 'all';

  get filteredListings(): EnhancedListing[] {
    if (this.bidFilter === 'all') return this.listings;
    return this.listings.filter(l => {
      if (this.bidFilter === 'winning') return l.isWinner === true;
      if (this.bidFilter === 'ended') return l.status === 'ended' || l.status === 'cancelled';
      if (this.bidFilter === 'outbid') return l.status === 'active' && !l.isWinner;
      return true;
    });
  }

  getBidCardClass(listing: EnhancedListing): string {
    if (listing.isWinner) return 'winning';
    if (listing.status === 'ended' || listing.status === 'cancelled') return 'ended';
    if (listing.status === 'active') return 'outbid';
    return '';
  }

  getInitials(title: string): string {
    return title.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

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
        this.error = err?.error?.message || err?.message || this.translate.instant('dashboard.myBets.errorLoading');
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
      case 'withdrawn': return 'status-withdrawn';
      default: return 'status-default';
    }
  }

  /**
   * Buyer may withdraw only pending offers.
   * Accepted / rejected / withdrawn: never.
   * Ended listing: still allowed while pending (seller may leave offers open).
   */
  canWithdrawBet(listing: EnhancedListing, bet: BetItem): boolean {
    if (bet.type !== 'offer' || bet.status !== 'pending') return false;
    if (listing.isWinner) return false;
    return true;
  }

  withdrawOffer(listing: EnhancedListing, bet: BetItem, event: Event): void {
    event.stopPropagation();
    if (!this.canWithdrawBet(listing, bet) || this.withdrawingId) return;
    this.withdrawingId = bet._id;
    this.offersService.withdrawOffer(bet._id).subscribe({
      next: (updated) => {
        bet.status = updated.status || 'withdrawn';
        this.withdrawingId = null;
        if (listing.auctionFormat === 'best-offer') {
          const pendingOrAccepted = (listing.bets || []).filter(
            (b) => b.type === 'offer' && (b.status === 'pending' || b.status === 'accepted')
          );
          listing.bidCount = pendingOrAccepted.length;
          listing.currentPrice = pendingOrAccepted.length
            ? Math.max(...pendingOrAccepted.map((b) => b.amount))
            : 0;
          listing.myHighestBid = pendingOrAccepted.length
            ? Math.max(...pendingOrAccepted.map((b) => b.amount))
            : listing.myHighestBid;
        }
      },
      error: (err) => {
        this.withdrawingId = null;
        this.error = err?.error?.message || this.translate.instant('dashboard.myBets.withdrawError');
      }
    });
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
    return new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: 'EUR',
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

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      pending: 'dashboard.myBets.statusPending',
      accepted: 'dashboard.myBets.statusAccepted',
      rejected: 'dashboard.myBets.statusRejected',
      withdrawn: 'dashboard.myBets.statusWithdrawn',
      active: 'dashboard.myBets.statusActive',
      ended: 'dashboard.myBets.statusEnded',
      cancelled: 'dashboard.myBets.statusCancelled'
    };
    const key = map[status] || `dashboard.myBets.status${status.charAt(0).toUpperCase() + status.slice(1)}`;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : status;
  }
}
