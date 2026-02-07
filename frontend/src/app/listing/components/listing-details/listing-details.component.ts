import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService, Bid } from '../../../shared/services/bids.service';
import { OffersService, Offer } from '../../../shared/services/offers.service';
import { WatchlistService } from '../../../shared/services/watchlist.service';
import { SocketService } from '../../../shared/services/socket.service';
import { AuthService } from '../../../auth/services/auth.service';
import { PrivateRoomService, Bidder } from '../../../private-room/services/private-room.service';

@Component({
  selector: 'app-listing-details',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent, FooterComponent],
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
  inWatchlist = false;
  showLoginModal = false;
  watchlistLoading = false;
  isOwnListing = false;
  showSelectWinnerModal = false;
  selectingWinner = false;
  reopenLoading = false;
  showCreatePrivateRoomModal = false;
  createPrivateRoomBidders: Bidder[] = [];
  createPrivateRoomBiddersLoading = false;
  selectedPrivateRoomBidderIds: Set<string> = new Set();
  createPrivateRoomSubmitting = false;
  private socketSubscriptions: Subscription[] = [];
  private countdownInterval: any = null;
  private justEndedRefetched = false;
  displayedTimeRemaining: string = '';

  // Place Bid modal
  showBidModal = false;
  bidAmount: string = '';
  bidEmail: string = '';
  bidNotifyWhenOutbid = true;
  bidSubmitting = false;
  bidModalError: string | null = null;

  // Make Offer modal
  showOfferModal = false;
  offerAmount: string = '';
  offerEmail: string = '';
  offerSubmitting = false;
  offerModalError: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private listingsService: ListingsService,
    private bidsService: BidsService,
    private offersService: OffersService,
    private watchlistService: WatchlistService,
    private socketService: SocketService,
    private authService: AuthService,
    private privateRoomService: PrivateRoomService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    window.scrollTo(0, 0);
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      this.loadListing(slug);
    } else {
      this.error = 'Invalid listing URL';
      this.loading = false;
    }
    
    // Check authentication status and whether current user is the seller
    this.authService.isAuthenticated().subscribe(isAuth => {
      this.isAuthenticated = isAuth;
      this.updateIsOwnListing();
    });
    this.authService.currentUser$.subscribe(() => this.updateIsOwnListing());
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
        this.inWatchlist = !!listing.inWatchlist;
        this.updateIsOwnListing();
        this.loading = false;
        window.scrollTo(0, 0);
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
        this.countdownInterval = null;
      }
      // Refetch listing once so we get updated status/privateRoomStatus (e.g. eligible for private room)
      if (!this.justEndedRefetched && this.listing?.slug) {
        this.justEndedRefetched = true;
        this.listingsService.getListingBySlug(this.listing.slug).subscribe({
          next: (listing) => {
            this.listing = listing;
            this.updateIsOwnListing();
            this.startCountdown();
            this.cdr.detectChanges();
          }
        });
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

  /** Bid count for ended highest-bid auctions (used for seller UI: select winner vs reopen). */
  getEndedBidCount(): number {
    if (!this.listing || this.listing.auctionFormat !== 'highest-bid') return 0;
    return this.listing.bidCount ?? 0;
  }

  /** Only registered, verified bidders can be selected as winner. */
  canSelectBidAsWinner(bid: Bid): boolean {
    return !!(bid.isAuthenticated && bid.bidderVerified);
  }

  hasPrivateRoom(): boolean {
    return this.listing?.privateRoomStatus === 'active';
  }

  /** True when this listing had a private room that has ended (winner was auto-selected by 60s rule; seller must not choose). */
  isPrivateRoomEnded(): boolean {
    return !!(this.listing?.allowPrivateRoom && this.listing?.privateRoomStatus === 'ended');
  }

  /** Seller can create private room when auction ended, private room enabled, eligible, within 1h deadline, and there are bids. */
  canCreatePrivateRoom(): boolean {
    if (!this.listing || !this.isOwnListing || this.listing.auctionFormat !== 'highest-bid') return false;
    if (this.listing.status !== 'ended' || !this.listing.allowPrivateRoom || this.listing.privateRoomStatus !== 'eligible' || (this.getEndedBidCount() ?? 0) === 0) return false;
    if (this.listing.winnerSelectionDeadline && new Date(this.listing.winnerSelectionDeadline) < new Date()) return false;
    return true;
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

  getReturnPolicyLabel(value: string): string {
    const labels: Record<string, string> = {
      '30-days': '30 Day Returns',
      '14-days': '14 Day Returns',
      'no-returns': 'No Returns Accepted',
      'custom': 'Custom Policy'
    };
    return labels[value] || value || '';
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

  getMinBid(): number {
    if (!this.listing) return 0;
    const current = this.listing.currentPrice || this.listing.startingPrice;
    return current + (this.listing.bidIncrement || 1);
  }

  openBidModal(): void {
    if (!this.listing) return;
    this.bidAmount = '';
    this.bidEmail = '';
    this.bidNotifyWhenOutbid = true;
    this.bidModalError = null;
    this.showBidModal = true;
  }

  closeBidModal(): void {
    this.showBidModal = false;
    this.bidModalError = null;
  }

  submitBid(): void {
    if (!this.listing) return;
    this.bidModalError = null;
    const minBid = this.getMinBid();
    const amount = parseFloat((this.bidAmount || '').replace(/[^0-9.]/g, ''));
    if (isNaN(amount) || amount < minBid) {
      this.bidModalError = `Your bid must be at least ${this.formatPrice(minBid)}.`;
      return;
    }
    let email: string | undefined;
    if (!this.isAuthenticated) {
      const trimmed = (this.bidEmail || '').trim();
      if (!trimmed) {
        this.bidModalError = 'Please enter your email address to receive bid notifications.';
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        this.bidModalError = 'Please enter a valid email address.';
        return;
      }
      email = trimmed;
    }
    this.bidSubmitting = true;
    const bidData: any = { listingId: this.listing._id, amount, bidType: 'manual', notifyWhenOutbid: this.bidNotifyWhenOutbid };
    if (!this.isAuthenticated && email) bidData.email = email;
    this.bidsService.createBid(bidData).subscribe({
      next: () => {
        this.bidSubmitting = false;
        this.closeBidModal();
        if (this.listing?._id) this.loadBids(this.listing._id);
        Swal.fire({
          icon: 'success',
          title: 'Bid placed',
          html: this.isAuthenticated
            ? 'Your bid has been placed. You\'ll see it in the bid history and receive updates if you\'re outbid.'
            : 'Your bid has been placed. Check your email for confirmation and updates.',
          confirmButtonColor: '#7A4F84'
        });
      },
      error: (err) => {
        this.bidSubmitting = false;
        const msg = err.error?.message || 'Failed to place bid. Please try again.';
        this.bidModalError = msg;
        Swal.fire({
          icon: 'error',
          title: 'Bid failed',
          text: msg,
          confirmButtonColor: '#7A4F84'
        });
      }
    });
  }

  openOfferModal(): void {
    if (!this.listing) return;
    this.offerAmount = '';
    this.offerEmail = '';
    this.offerModalError = null;
    this.showOfferModal = true;
  }

  closeOfferModal(): void {
    this.showOfferModal = false;
    this.offerModalError = null;
  }

  /** Parsed offer amount as number (for template: below-minimum indication). */
  getOfferAmountNumber(): number {
    const n = parseFloat((this.offerAmount || '').replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  /** True when the user has entered an amount and it is below the seller's minimum (don't show when field is empty). */
  isOfferBelowMinimum(): boolean {
    const min = this.listing?.minimumOfferPrice;
    if (min == null) return false;
    const amount = this.getOfferAmountNumber();
    return amount > 0 && amount < min;
  }

  submitOffer(): void {
    if (!this.listing) return;
    this.offerModalError = null;
    const amount = parseFloat((this.offerAmount || '').replace(/[^0-9.]/g, ''));
    if (isNaN(amount) || amount <= 0) {
      this.offerModalError = 'Please enter a valid amount.';
      return;
    }
    // Allow offers below minimum; seller is not obliged to accept (we show an indication in the modal)
    let email: string | undefined;
    if (!this.isAuthenticated) {
      const trimmed = (this.offerEmail || '').trim();
      if (!trimmed) {
        this.offerModalError = 'Please enter your email so the seller can contact you.';
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        this.offerModalError = 'Please enter a valid email address.';
        return;
      }
      email = trimmed;
    }
    this.offerSubmitting = true;
    const offerData: { listingId: string; amount: number; email?: string } = {
      listingId: this.listing._id!,
      amount
    };
    if (!this.isAuthenticated && email) offerData.email = email;
    this.offersService.createOffer(offerData).subscribe({
      next: () => {
        this.offerSubmitting = false;
        this.closeOfferModal();
        if (this.listing?._id) this.loadOffers(this.listing._id);
        Swal.fire({
          icon: 'success',
          title: 'Offer sent',
          html: 'Your offer has been sent to the seller. They will review it and you\'ll be notified of their decision.',
          confirmButtonColor: '#7A4F84'
        });
      },
      error: (err) => {
        this.offerSubmitting = false;
        const msg = err.error?.message || 'Failed to place offer. Please try again.';
        this.offerModalError = msg;
        Swal.fire({
          icon: 'error',
          title: 'Offer failed',
          text: msg,
          confirmButtonColor: '#7A4F84'
        });
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
    if (!this.listing?._id) return;
    if (!this.isAuthenticated) {
      this.showLoginModal = true;
      return;
    }
    this.watchlistLoading = true;
    if (this.inWatchlist) {
      this.watchlistService.remove(this.listing._id).subscribe({
        next: (res) => {
          this.inWatchlist = res.inWatchlist;
          this.watchlistLoading = false;
          this.updateListingWatchlistCount(-1);
          this.cdr.detectChanges();
        },
        error: () => {
          this.watchlistLoading = false;
          this.cdr.detectChanges();
        }
      });
    } else {
      this.watchlistService.add(this.listing._id).subscribe({
        next: (res) => {
          this.inWatchlist = res.inWatchlist;
          this.watchlistLoading = false;
          this.updateListingWatchlistCount(1);
          this.cdr.detectChanges();
        },
        error: () => {
          this.watchlistLoading = false;
          this.cdr.detectChanges();
        }
      });
    }
  }

  private updateListingWatchlistCount(delta: number): void {
    if (!this.listing) return;
    const current = this.listing.watchlistCount ?? 0;
    this.listing = { ...this.listing, watchlistCount: Math.max(0, current + delta) };
  }

  updateIsOwnListing(): void {
    if (!this.listing?.seller?.email) {
      this.isOwnListing = false;
      return;
    }
    const currentUser = this.authService.getCurrentUser();
    this.isOwnListing = !!(
      currentUser?.email &&
      this.listing.seller.email &&
      currentUser.email.toLowerCase() === (this.listing.seller as { email?: string }).email?.toLowerCase()
    );
    this.cdr.detectChanges();
  }

  closeLoginModal(): void {
    this.showLoginModal = false;
  }

  goToLogin(): void {
    const returnUrl = this.listing?.slug ? `/listing/${this.listing.slug}` : '/listing/list';
    this.router.navigate(['/auth/login'], { queryParams: { returnUrl } });
    this.closeLoginModal();
  }

  goToSignup(): void {
    const returnUrl = this.listing?.slug ? `/listing/${this.listing.slug}` : '/listing/list';
    this.router.navigate(['/auth/signup'], { queryParams: { returnUrl } });
    this.closeLoginModal();
  }

  openSelectWinnerModal(): void {
    this.showSelectWinnerModal = true;
    if (this.listing?._id && this.bids.length === 0 && !this.bidsLoading) {
      this.loadBids(this.listing._id);
    }
  }

  closeSelectWinnerModal(): void {
    this.showSelectWinnerModal = false;
  }

  selectWinner(bidId: string): void {
    if (!this.listing?._id || this.selectingWinner) return;
    this.selectingWinner = true;
    this.listingsService.chooseWinner(this.listing._id, bidId).subscribe({
      next: (res) => {
        this.listing = res.listing;
        this.closeSelectWinnerModal();
        this.selectingWinner = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.selectingWinner = false;
        this.cdr.detectChanges();
        alert(err.error?.message || 'Failed to select winner');
      }
    });
  }

  reopenAuction(): void {
    if (!this.listing?._id || this.reopenLoading) return;
    this.reopenLoading = true;
    this.listingsService.reopen(this.listing._id).subscribe({
      next: (res) => {
        this.listing = res.listing;
        this.reopenLoading = false;
        this.startCountdown();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.reopenLoading = false;
        this.cdr.detectChanges();
        alert(err.error?.message || 'Failed to reopen auction');
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/listing/list']);
  }

  openPrivateRoom(): void {
    if (!this.listing?._id) return;
    const url = `/private-room/auction/${this.listing._id}`;
    window.open(url, '_blank', 'width=1200,height=800');
  }

  openCreatePrivateRoomModal(): void {
    this.showCreatePrivateRoomModal = true;
    this.selectedPrivateRoomBidderIds = new Set();
    if (this.listing?._id) {
      this.createPrivateRoomBiddersLoading = true;
      this.privateRoomService.getBidders(this.listing._id).subscribe({
        next: (res) => {
          this.createPrivateRoomBidders = res.bidders || [];
          this.createPrivateRoomBiddersLoading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.createPrivateRoomBiddersLoading = false;
          this.cdr.detectChanges();
        }
      });
    }
  }

  closeCreatePrivateRoomModal(): void {
    this.showCreatePrivateRoomModal = false;
    this.createPrivateRoomBidders = [];
    this.selectedPrivateRoomBidderIds = new Set();
  }

  togglePrivateRoomBidder(bidder: Bidder): void {
    if (!bidder._id || !bidder.isAuthenticated) return;
    const id = bidder._id;
    if (this.selectedPrivateRoomBidderIds.has(id)) {
      this.selectedPrivateRoomBidderIds.delete(id);
    } else {
      if (this.selectedPrivateRoomBidderIds.size >= 5) return;
      this.selectedPrivateRoomBidderIds.add(id);
    }
    this.selectedPrivateRoomBidderIds = new Set(this.selectedPrivateRoomBidderIds);
    this.cdr.detectChanges();
  }

  isPrivateRoomBidderSelected(bidder: Bidder): boolean {
    return !!(bidder._id && this.selectedPrivateRoomBidderIds.has(bidder._id));
  }

  submitCreatePrivateRoom(): void {
    if (!this.listing?._id || this.createPrivateRoomSubmitting) return;
    const ids = Array.from(this.selectedPrivateRoomBidderIds);
    if (ids.length < 2) {
      alert('Please select between 2 and 5 bidders for the private room.');
      return;
    }
    if (ids.length > 5) {
      alert('You can invite at most 5 bidders.');
      return;
    }
    this.createPrivateRoomSubmitting = true;
    this.privateRoomService.selectPlatinumBidders(this.listing._id, ids).subscribe({
      next: (res) => {
        if (this.listing && res.listing) {
          const u = res.listing as { status?: string; privateRoomStatus?: string; privateRoomEndDate?: string; endDate?: string; platinumBidders?: string[]; platinumBidderInvitedAt?: string };
          if (u.status) this.listing.status = u.status as Listing['status'];
          if (u.privateRoomStatus) this.listing.privateRoomStatus = u.privateRoomStatus as Listing['privateRoomStatus'];
          if (u.privateRoomEndDate) this.listing.privateRoomEndDate = u.privateRoomEndDate;
          if (u.endDate) this.listing.endDate = u.endDate;
          if (u.platinumBidders) this.listing.platinumBidders = u.platinumBidders;
          if (u.platinumBidderInvitedAt) this.listing.platinumBidderInvitedAt = u.platinumBidderInvitedAt;
        }
        this.closeCreatePrivateRoomModal();
        this.createPrivateRoomSubmitting = false;
        this.startCountdown();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.createPrivateRoomSubmitting = false;
        this.cdr.detectChanges();
        alert(err.error?.message || err.error?.error || 'Failed to create private room');
      }
    });
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

