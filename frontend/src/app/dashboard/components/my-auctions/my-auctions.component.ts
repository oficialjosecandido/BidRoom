import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { SocketService } from '../../../shared/services/socket.service';
import Swal from 'sweetalert2';

const successToast = Swal.mixin({
  toast: true,
  position: 'top-end',
  icon: 'success',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true
});

type UnsoldReason = 'no_bids' | 'reserve_not_met' | 'non_payment';
type DurationSlot = '5 minutes' | '1 hour' | '2 hours' | '7 hours' | '24 hours' | '3 days' | '7 days';

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
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule],
  templateUrl: './my-auctions.component.html',
  styleUrls: ['./my-auctions.component.scss']
})
export class MyAuctionsComponent implements OnInit, OnDestroy {
  private listingsService = inject(ListingsService);
  private socketService = inject(SocketService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  listings: EnhancedListing[] = [];
  isLoading = true;
  error: string | null = null;

  // ── Relist modal ────────────────────────────────────────────────────────────
  relistListing: EnhancedListing | null = null;
  relistStartingPrice: number = 0;
  relistReservePrice: number | null = null;
  relistDurationSlot: DurationSlot = '7 days';
  relistAutoRelist = false;
  relistSubmitting = false;
  relistError: string | null = null;

  readonly durationOptions: DurationSlot[] = ['24 hours', '3 days', '7 days'];

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
        this.error = error?.message || this.translate.instant('dashboard.myAuctions.errorLoading');
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

  // ── Relist eligibility ──────────────────────────────────────────────────────

  /** True when the listing ended unsold and has not been relisted yet. */
  isEligibleForRelist(listing: EnhancedListing): boolean {
    if (listing.status !== 'ended') return false;
    if (listing.relistedAt) return false;
    if (listing.winner) return false;
    return true;
  }

  getUnsoldReason(listing: EnhancedListing): UnsoldReason {
    if (listing.privateRoomClosedReason === 'non_payment_no_second_bidder') return 'non_payment';
    if ((listing.bidCount ?? 0) === 0) return 'no_bids';
    return 'reserve_not_met';
  }

  // ── Relist modal ────────────────────────────────────────────────────────────

  openRelistModal(listing: EnhancedListing): void {
    this.relistListing = listing;
    this.relistStartingPrice = listing.startingPrice;
    this.relistReservePrice = listing.reservePrice ?? null;
    this.relistDurationSlot = (listing.durationSlot as DurationSlot) || '7 days';
    this.relistAutoRelist = false;
    this.relistError = null;
    this.relistSubmitting = false;
  }

  closeRelistModal(): void {
    this.relistListing = null;
  }

  /** Smart suggestion: lower starting price by 10%. */
  applySuggestLowerPrice(): void {
    this.relistStartingPrice = Math.max(0.01, Math.round(this.relistStartingPrice * 0.9 * 100) / 100);
  }

  /** Smart suggestion: lower reserve price by 10%. */
  applySuggestLowerReserve(): void {
    if (this.relistReservePrice) {
      this.relistReservePrice = Math.max(0.01, Math.round(this.relistReservePrice * 0.9 * 100) / 100);
    }
  }

  /** Smart suggestion: remove reserve price entirely. */
  applySuggestRemoveReserve(): void {
    this.relistReservePrice = null;
  }

  /** Smart suggestion: set to maximum duration. */
  applySuggestMaxDuration(): void {
    this.relistDurationSlot = '7 days';
  }

  getSmartSuggestions(listing: EnhancedListing): Array<{ key: string; action: () => void }> {
    const reason = this.getUnsoldReason(listing);
    const suggestions: Array<{ key: string; action: () => void }> = [];

    if (reason === 'no_bids') {
      suggestions.push({ key: 'dashboard.myAuctions.relist.suggestions.lower10Price', action: () => this.applySuggestLowerPrice() });
      if (this.relistDurationSlot !== '7 days') {
        suggestions.push({ key: 'dashboard.myAuctions.relist.suggestions.extend7Days', action: () => this.applySuggestMaxDuration() });
      }
    } else if (reason === 'reserve_not_met') {
      if (this.relistReservePrice) {
        suggestions.push({ key: 'dashboard.myAuctions.relist.suggestions.lower10Reserve', action: () => this.applySuggestLowerReserve() });
        suggestions.push({ key: 'dashboard.myAuctions.relist.suggestions.removeReserve', action: () => this.applySuggestRemoveReserve() });
      }
    } else if (reason === 'non_payment') {
      if (this.relistDurationSlot !== '7 days') {
        suggestions.push({ key: 'dashboard.myAuctions.relist.suggestions.extend7Days', action: () => this.applySuggestMaxDuration() });
      }
    }

    return suggestions;
  }

  submitRelist(): void {
    if (!this.relistListing || this.relistSubmitting) return;
    this.relistSubmitting = true;
    this.relistError = null;

    this.listingsService.relistListing(this.relistListing._id, {
      startingPrice: this.relistStartingPrice,
      reservePrice: this.relistReservePrice,
      durationSlot: this.relistDurationSlot,
      autoRelist: this.relistAutoRelist,
    }).subscribe({
      next: (res) => {
        this.relistSubmitting = false;
        this.closeRelistModal();
        successToast.fire({ title: this.translate.instant('dashboard.myAuctions.relistSuccess') });
        if (res.listing?.slug) {
          this.router.navigate(['/listing', res.listing.slug]);
        } else {
          this.loadMyListings();
        }
      },
      error: (err) => {
        this.relistSubmitting = false;
        this.relistError = err?.error?.message || this.translate.instant('dashboard.myAuctions.relistError');
      }
    });
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'active': return 'badge-active';
      case 'ended': return 'badge-ended';
      case 'cancelled': return 'badge-cancelled';
      case 'draft': return 'badge-draft';
      default: return 'badge-default';
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

  formatPrice(value: number | null | undefined): string {
    if (value == null) return '—';
    return '$' + value.toFixed(2);
  }
}
