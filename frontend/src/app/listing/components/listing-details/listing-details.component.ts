import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService, Bid } from '../../../shared/services/bids.service';
import { OffersService, Offer } from '../../../shared/services/offers.service';
import { SocketService } from '../../../shared/services/socket.service';
import { AuthService } from '../../../auth/services/auth.service';

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
  activeTab: 'description' | 'bids' | 'offers' = 'description';
  bids: Bid[] = [];
  bidsLoading = false;
  bidsError: string | null = null;
  offers: Offer[] = [];
  offersLoading = false;
  offersError: string | null = null;
  isAuthenticated = false;
  private socketSubscriptions: Subscription[] = [];
  private countdownInterval: any = null;
  displayedTimeRemaining: string = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private listingsService: ListingsService,
    private bidsService: BidsService,
    private offersService: OffersService,
    private socketService: SocketService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      this.loadListing(slug);
    } else {
      this.error = 'Invalid listing URL';
      this.loading = false;
    }
    
    // Check authentication status
    this.authService.isAuthenticated().subscribe(isAuth => {
      this.isAuthenticated = isAuth;
    });
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
        // Start countdown timer
        this.startCountdown();
        // Load bids or offers when listing is loaded
        if (listing._id) {
          if (listing.auctionFormat === 'best-offer') {
            this.loadOffers(listing._id);
          } else {
            this.loadBids(listing._id);
          }
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

  setActiveTab(tab: 'description' | 'bids' | 'offers'): void {
    this.activeTab = tab;
  }

  loadOffers(listingId: string): void {
    this.offersLoading = true;
    this.offersError = null;

    this.offersService.getOffersByListing(listingId).subscribe({
      next: (response) => {
        this.offers = response.offers;
        this.offersLoading = false;
      },
      error: (err) => {
        console.error('Error loading offers:', err);
        this.offersError = 'Failed to load offer history';
        this.offersLoading = false;
      }
    });
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

  startCountdown(): void {
    // Clear any existing interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    // Calculate and display immediately
    this.updateCountdown();

    // Update every second
    this.countdownInterval = setInterval(() => {
      this.updateCountdown();
    }, 1000);
  }

  updateCountdown(): void {
    if (!this.listing) {
      this.displayedTimeRemaining = 'N/A';
      return;
    }

    // Determine which end date to use
    let endDate: Date | null = null;
    
    if (this.listing.privateRoomStatus === 'active' && this.listing.privateRoomEndDate) {
      endDate = new Date(this.listing.privateRoomEndDate);
    } else if (this.listing.endDate) {
      endDate = new Date(this.listing.endDate);
    }

    if (!endDate) {
      this.displayedTimeRemaining = 'N/A';
      return;
    }

    const now = new Date();
    const diff = endDate.getTime() - now.getTime();

    if (diff <= 0) {
      this.displayedTimeRemaining = 'Ended';
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
      }
      return;
    }

    // Calculate time components
    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = totalSeconds % 60;

    // If less than 24 hours remaining, show HH:MM:SS format
    if (days === 0) {
      const hStr = String(hours).padStart(2, '0');
      const mStr = String(minutes).padStart(2, '0');
      const sStr = String(seconds).padStart(2, '0');
      this.displayedTimeRemaining = `${hStr}:${mStr}:${sStr}`;
    } else {
      // If 24 hours or more, show days and hours
      const parts: string[] = [];
      if (days > 0) {
        parts.push(`${days} day${days !== 1 ? 's' : ''}`);
      }
      if (hours > 0) {
        parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
      }
      this.displayedTimeRemaining = parts.length > 0 ? parts.join(' ') : 'Ending Soon';
    }

    // Trigger change detection
    this.cdr.detectChanges();
  }

  formatTimeRemaining(): string {
    // Return the displayed time that updates in real-time
    return this.displayedTimeRemaining || (this.listing?.timeRemaining?.ended ? 'Ended' : 'N/A');
  }

  getAuctionEndType(): 'regular' | 'private-room' | 'ended' {
    if (!this.listing) return 'ended';
    if (this.listing.status === 'ended' || this.displayedTimeRemaining === 'Ended') return 'ended';
    if (this.listing.privateRoomStatus === 'active') return 'private-room';
    return 'regular';
  }

  isAuctionEnded(): boolean {
    return this.getAuctionEndType() === 'ended';
  }

  hasPrivateRoom(): boolean {
    return this.listing?.privateRoomStatus === 'active';
  }

  getAuctionEndLabel(): string {
    const endType = this.getAuctionEndType();
    switch (endType) {
      case 'private-room':
        return 'Private Room Ends';
      case 'ended':
        return 'Auction Ended';
      default:
        return 'Auction Ends';
    }
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

    // Subscribe to listing update events (price, bid count changes, private room updates)
    const listingUpdateSubscription = this.socketService.onListingUpdate().subscribe((event) => {
      if (event.listingId === listingId && this.listing) {
        this.listing.currentPrice = event.currentPrice;
        this.listing.bidCount = event.bidCount;
        
        // Update private room end date if provided (e.g., when private room is extended)
        if (event.privateRoomEndDate) {
          this.listing.privateRoomEndDate = event.privateRoomEndDate;
        }
        
        // Update private room status if provided
        if (event.privateRoomStatus) {
          this.listing.privateRoomStatus = event.privateRoomStatus;
        }
        
        // Restart countdown if end date changed
        this.startCountdown();
      }
    });
    this.socketSubscriptions.push(listingUpdateSubscription);
  }

  placeBid(): void {
    if (!this.listing) return;

    const currentPrice = this.listing.currentPrice || this.listing.startingPrice;
    const minBid = currentPrice + (this.listing.bidIncrement || 1);
    
    // Collect bid amount
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

    // Collect email if user is not authenticated
    let email: string | undefined = undefined;
    if (!this.isAuthenticated) {
      const emailInput = prompt(
        `Please provide your email address:\n` +
        `(You'll receive notifications about this bid)`
      );

      if (!emailInput) {
        alert('Email is required to place a bid. Please provide your email address.');
        return;
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailInput.trim())) {
        alert('Please enter a valid email address.');
        return;
      }

      email = emailInput.trim();
    }

    // Place bid via HTTP API (Socket.io will broadcast automatically on backend)
    const bidData: any = {
      listingId: this.listing._id,
      amount: bidAmount,
      bidType: 'manual'
    };

    // Include email if user is not authenticated
    if (!this.isAuthenticated && email) {
      bidData.email = email;
    }

    this.bidsService.createBid(bidData).subscribe({
      next: (bid) => {
        // Bid was placed successfully
        if (!this.isAuthenticated) {
          alert('Bid placed successfully! Please check your email for confirmation.');
        }
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
    if (!this.listing) return;

    const startingPrice = this.listing.startingPrice || this.listing.currentPrice || 0;
    const minimumOffer = this.listing.minimumOfferPrice || startingPrice;
    
    const offerAmountStr = prompt(
      `Starting Offer: ${this.formatPrice(startingPrice)}\n` +
      (this.listing.minimumOfferPrice ? `Minimum Offer: ${this.formatPrice(this.listing.minimumOfferPrice)}\n` : '') +
      `\nEnter your offer amount:`
    );

    if (!offerAmountStr) return;

    const offerAmount = parseFloat(offerAmountStr.replace(/[^0-9.]/g, ''));

    if (isNaN(offerAmount)) {
      alert('Please enter a valid amount');
      return;
    }

    if (this.listing.minimumOfferPrice && offerAmount < this.listing.minimumOfferPrice) {
      alert(`Offer amount must be at least ${this.formatPrice(this.listing.minimumOfferPrice)}`);
      return;
    }

    const message = prompt('Optional message to seller (press Cancel to skip):');

    // Create offer via HTTP API
    this.offersService.createOffer({
      listingId: this.listing._id!,
      amount: offerAmount,
      message: message || undefined
    }).subscribe({
      next: (offer) => {
        // Offer was placed successfully
        alert('Offer placed successfully! The seller will review your offer.');
        // Reload offers to show the new one
        if (this.listing?._id) {
          this.loadOffers(this.listing._id);
        }
      },
      error: (err) => {
        console.error('Error placing offer:', err);
        alert(err.error?.message || 'Failed to place offer. Please try again.');
      }
    });
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

  openPrivateRoom(): void {
    if (!this.listing?._id) return;
    const url = `/private-room/auction/${this.listing._id}`;
    window.open(url, '_blank', 'width=1200,height=800');
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

  formatOfferDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  formatOfferStatus(status: string): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'accepted':
        return 'Accepted';
      case 'rejected':
        return 'Rejected';
      case 'expired':
        return 'Expired';
      default:
        return status;
    }
  }

  isBestOfferListing(): boolean {
    return this.listing?.auctionFormat === 'best-offer';
  }

  getOfferOrBidCount(): number {
    if (!this.listing) return 0;
    if (this.listing.auctionFormat === 'best-offer') {
      // For best-offer listings, use the actual offers array length
      return this.offers.length;
    }
    // For auction listings, use bidCount from listing
    return this.listing.bidCount || 0;
  }

  ngOnDestroy(): void {
    // Clear countdown interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

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

