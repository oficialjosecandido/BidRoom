import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService, Bid } from '../../../shared/services/bids.service';
import { SocketService } from '../../../shared/services/socket.service';

@Component({
  selector: 'app-listing-details',
  standalone: true,
  imports: [CommonModule, HeaderComponent, FooterComponent],
  templateUrl: './listing-details.component.html',
  styleUrls: ['./listing-details.component.scss']
})
export class ListingDetailsComponent implements OnInit, OnDestroy {
  listing: Listing | null = null;
  loading = true;
  error: string | null = null;
  activeImageIndex = 0;
  activeTab: 'description' | 'bids' = 'description';
  bids: Bid[] = [];
  bidsLoading = false;
  bidsError: string | null = null;
  private socketSubscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private listingsService: ListingsService,
    private bidsService: BidsService,
    private socketService: SocketService
  ) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      this.loadListing(slug);
    } else {
      this.error = 'Invalid listing URL';
      this.loading = false;
    }
  }

  loadListing(slug: string): void {
    if (!slug) {
      this.error = 'Invalid listing URL';
      this.loading = false;
      return;
    }

    this.loading = true;
    this.error = null;

    this.listingsService.getListingBySlug(slug).subscribe({
      next: (listing) => {
        this.listing = listing;
        this.loading = false;
        // Load bids when listing is loaded
        if (listing._id) {
          this.loadBids(listing._id);
          // Connect to Socket.io and join listing room for real-time updates
          this.setupRealTimeUpdates(listing._id);
        }
      },
      error: (err) => {
        console.error('Error loading listing:', err);
        this.error = 'Listing not found';
        this.loading = false;
      }
    });
  }

  loadBids(listingId: string): void {
    this.bidsLoading = true;
    this.bidsError = null;

    this.bidsService.getBidsByListing(listingId, 'desc').subscribe({
      next: (response) => {
        this.bids = response.bids;
        this.bidsLoading = false;
      },
      error: (err) => {
        console.error('Error loading bids:', err);
        this.bidsError = 'Failed to load bid history';
        this.bidsLoading = false;
      }
    });
  }

  setActiveTab(tab: 'description' | 'bids'): void {
    this.activeTab = tab;
  }

  setActiveImage(index: number): void {
    this.activeImageIndex = index;
  }

  formatPrice(price: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(price);
  }

  formatTimeRemaining(): string {
    if (!this.listing?.timeRemaining) return 'N/A';
    
    const { ended, days, hours, minutes } = this.listing.timeRemaining;
    
    if (ended) return 'Ended';
    
    // Format with days, hours, and minutes for clarity
    const parts: string[] = [];
    
    if (days > 0) {
      parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    }
    if (hours > 0) {
      parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    if (minutes > 0 && days === 0) {
      // Only show minutes if less than a day remaining (for urgency)
      parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }
    
    if (parts.length === 0) {
      return 'Ending Soon';
    }
    
    return parts.join(' ');
  }

  setupRealTimeUpdates(listingId: string): void {
    // Connect to Socket.io
    this.socketService.connect();

    // Join the listing room
    this.socketService.joinListing(listingId);

    // Subscribe to new bid events
    const newBidSubscription = this.socketService.onNewBid().subscribe((event) => {
      if (event.listingId === listingId) {
        // Add new bid to the list (prepend since we sort desc)
        this.bids = [event.bid, ...this.bids];
        
        // Update listing current price and bid count
        if (this.listing) {
          this.listing.currentPrice = event.currentPrice;
          this.listing.bidCount = event.bidCount;
        }
      }
    });
    this.socketSubscriptions.push(newBidSubscription);

    // Subscribe to listing update events (price, bid count changes)
    const listingUpdateSubscription = this.socketService.onListingUpdate().subscribe((event) => {
      if (event.listingId === listingId && this.listing) {
        this.listing.currentPrice = event.currentPrice;
        this.listing.bidCount = event.bidCount;
      }
    });
    this.socketSubscriptions.push(listingUpdateSubscription);
  }

  placeBid(): void {
    if (!this.listing) return;

    const currentPrice = this.listing.currentPrice || this.listing.startingPrice;
    const minBid = currentPrice + (this.listing.bidIncrement || 1);
    
    const bidAmountStr = prompt(
      `Current bid: ${this.formatPrice(currentPrice)}\n` +
      `Minimum bid: ${this.formatPrice(minBid)}\n\n` +
      `Enter your bid amount:`
    );

    if (!bidAmountStr) return;

    const bidAmount = parseFloat(bidAmountStr.replace(/[^0-9.]/g, ''));

    if (isNaN(bidAmount) || bidAmount < minBid) {
      alert(`Bid amount must be at least ${this.formatPrice(minBid)}`);
      return;
    }

    // Place bid via HTTP API (Socket.io will broadcast automatically on backend)
    this.bidsService.createBid({
      listingId: this.listing._id,
      amount: bidAmount,
      bidType: 'manual'
    }).subscribe({
      next: (bid) => {
        // Bid was placed successfully
        // Real-time update will come through Socket.io automatically
        // Optionally reload bids to ensure sync
        if (this.listing?._id) {
          this.loadBids(this.listing._id);
        }
      },
      error: (err) => {
        console.error('Error placing bid:', err);
        alert(err.error?.message || 'Failed to place bid. Please try again.');
      }
    });
  }

  placeOffer(): void {
    // TODO: Implement offer placement for Best Offer format
    alert('Offer placement functionality coming soon!');
  }

  buyNow(): void {
    if (!this.listing) return;
    
    if (confirm(`Buy this item now for ${this.formatPrice(this.listing.buyNowPrice!)}? This will instantly close the auction.`)) {
      this.listingsService.buyNow(this.listing._id).subscribe({
        next: (response) => {
          alert('Purchase successful!');
          // Reload listing to show updated status
          if (this.listing?.slug) {
            this.loadListing(this.listing.slug);
          }
        },
        error: (err) => {
          console.error('Error buying now:', err);
          alert(err.error?.message || 'Failed to complete purchase');
        }
      });
    }
  }

  addToWatchlist(): void {
    // TODO: Implement watchlist functionality
    alert('Watchlist functionality coming soon!');
  }

  goBack(): void {
    this.router.navigate(['/listing/list']);
  }

  getFormattedDescription(): string {
    if (!this.listing?.description) return '';
    return this.listing.description.replace(/\n/g, '<br>');
  }

  formatBidDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  formatBidAmount(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  }

  ngOnDestroy(): void {
    // Unsubscribe from Socket.io events
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    
    // Leave listing room and disconnect
    if (this.listing?._id) {
      this.socketService.leaveListing(this.listing._id);
    }
    // Note: Don't disconnect socket completely as it might be used by other components
    // this.socketService.disconnect();
  }
}

