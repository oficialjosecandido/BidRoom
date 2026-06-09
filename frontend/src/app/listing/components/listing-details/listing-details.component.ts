import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject, computed } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter, finalize, take, timeout } from 'rxjs/operators';
import { MAX_DISPLAYED_BIDS, EMAIL_REGEX } from '../../../shared/config/listing.constants';
import Swal from 'sweetalert2';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService, Bid } from '../../../shared/services/bids.service';
import { OffersService, Offer } from '../../../shared/services/offers.service';
import { WatchlistService } from '../../../shared/services/watchlist.service';
import { SocketService } from '../../../shared/services/socket.service';
import { AuthService } from '../../../auth/services/auth.service';
import { PrivateRoomService, Bidder } from '../../../private-room/services/private-room.service';
import { StripeConnectService } from '../../../shared/services/stripe-connect.service';
import { FeatureFlagsService } from '../../../shared/services/feature-flags.service';
import { KycService } from '../../../shared/services/kyc.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReportModalComponent } from '../../../shared/components/report-modal/report-modal.component';
import { FollowService, FollowStatus } from '../../../shared/services/follow.service';
import { BlockService } from '../../../shared/services/block.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { getTrustTierInfo } from '../../../shared/utils/trust-tier.util';
import { SeoService } from '../../../shared/services/seo.service';
import { API_CONFIG } from '../../../shared/config/api.config';

@Component({
  selector: 'app-listing-details',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, RouterLink, ReportModalComponent, HeaderComponent, FooterComponent],
  templateUrl: './listing-details.component.html',
  styleUrls: ['./listing-details.component.scss']
})
export class ListingDetailsComponent implements OnInit, OnDestroy {
  readonly getTrustTierInfo = getTrustTierInfo;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private listingsService = inject(ListingsService);
  private bidsService = inject(BidsService);
  private offersService = inject(OffersService);
  private watchlistService = inject(WatchlistService);
  private socketService = inject(SocketService);
  private authService = inject(AuthService);
  private privateRoomService = inject(PrivateRoomService);
  private stripeConnectService = inject(StripeConnectService);
  featureFlags = inject(FeatureFlagsService);
  private kycService = inject(KycService);
  private followService = inject(FollowService);
  private blockService = inject(BlockService);
  private cdr = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  readonly themeService = inject(ThemeService);
  private seo = inject(SeoService);
  linkCopied = false;

  readonly isLight = computed(() => this.themeService.effective() === 'light');

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
  get isSeller(): boolean { return this.isOwnListing; }
  sellerFollowStatus: FollowStatus = { following: false, muted: false };
  followLoading = false;
  sellerBlocked = false;
  blockLoading = false;
  showSelectWinnerModal = false;
  showReportModal: 'listing' | 'user' | null = null;
  selectingWinner = false;
  reopenLoading = false;
  showCreatePrivateRoomModal = false;
  createPrivateRoomBidders: Bidder[] = [];
  createPrivateRoomBiddersLoading = false;
  selectedPrivateRoomBidderIds = new Set<string>();
  createPrivateRoomSubmitting = false;
  privateRoomStartNowLoading = false;
  private socketSubscriptions: Subscription[] = [];
  /** Real-time bid/listing socket subs — tracked separately so they can be cleaned up on re-entry without unsubbing auth subs. */
  private rtSubscriptions: Subscription[] = [];
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private justEndedRefetched = false;
  private offerRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly OFFER_REFRESH_DEBOUNCE_MS = 2000;
  /** Ensures /listing/:slug/choose-winner deep link runs once after load. */
  private chooseWinnerDeepLinkHandled = false;
  displayedTimeRemaining = '';
  private countdownEnded = false;
  winnerSelectionCountdownDisplay = '';
  newBidIds = new Set<string>();

  // Place Bid modal
  showBidModal = false;
  bidAmount = '';
  bidEmail = '';
  bidNotifyWhenOutbid = true;
  bidSubmitting = false;
  bidModalError: string | null = null;

  // Make Offer modal
  showOfferModal = false;
  offerAmount = '';
  offerEmail = '';
  offerSubmitting = false;
  offerModalError: string | null = null;
  /** ID of offer being accepted/rejected (for loading state) */
  offerActionLoadingId: string | null = null;
  /** Whether the current seller has Stripe connected and onboarded */
  sellerStripeReady = true;

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
    this.socketSubscriptions.push(
      this.authService.isAuthenticated().subscribe(isAuth => {
        this.isAuthenticated = isAuth;
        this.updateIsOwnListing();
      })
    );
    this.socketSubscriptions.push(
      this.authService.currentUser$.subscribe(() => this.updateIsOwnListing())
    );
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
        this.seo.setListing(listing, this.buildShareUrl(listing.slug));
        if (this.isAuthenticated && !this.isOwnListing && listing.seller?._id) {
          this.loadSellerFollowStatus(listing.seller._id);
          this.loadSellerBlockStatus(listing.seller._id);
        }
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
      error: () => {
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
        this.handleChooseWinnerDeepLink();
      },
      error: () => {
        this.bidsError = 'Failed to load bid history';
        this.bidsLoading = false;
        this.handleChooseWinnerDeepLink();
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
      error: () => {
        this.offersError = 'Failed to load offer history';
        this.offersLoading = false;
      }
    });
  }

  /** Offers sorted: pending first, then accepted, then rejected/expired. Within each status, highest amount first. */
  get sortedOffers(): Offer[] {
    const order: Record<string, number> = { pending: 0, accepted: 1, rejected: 2, expired: 3 };
    return [...this.offers].sort((a, b) => {
      const statusA = order[a.status] ?? 4;
      const statusB = order[b.status] ?? 4;
      if (statusA !== statusB) return statusA - statusB;
      return (b.amount ?? 0) - (a.amount ?? 0);
    });
  }

  /** Highest pending/accepted offer amount for summary display. */
  get highestOfferAmount(): number | null {
    const valid = this.offers.filter(o => o.status === 'pending' || o.status === 'accepted');
    if (valid.length === 0) return null;
    return Math.max(...valid.map(o => o.amount));
  }

  /** Highest offer amount for best-offer listings (from pending or accepted offers). */
  getHighestOfferAmount(): number {
    if (!this.offers.length) return this.listing?.currentPrice ?? 0;
    const valid = this.offers.filter(o => o.status === 'pending' || o.status === 'accepted');
    if (valid.length === 0) return this.listing?.currentPrice ?? 0;
    return Math.max(...valid.map(o => o.amount));
  }

  /** True if the current user made this offer (by email match for authenticated users). */
  isMyOffer(offer: Offer): boolean {
    const user = this.authService.getCurrentUser();
    if (!user?.email || !offer.offerer) return false;
    return (offer.offerer as { email?: string }).email?.toLowerCase() === user.email.toLowerCase();
  }

  /** Best-offer listing is still open for offers (active and not ended). */
  isBestOfferActive(): boolean {
    if (!this.listing || this.listing.auctionFormat !== 'best-offer') return false;
    return this.listing.status === 'active' && !this.isAuctionEnded();
  }

  /** True when seller can accept/decline offers (Best Offer listing and listing end date has passed). */
  canSellerAcceptOrDeclineOffers(): boolean {
    if (!this.listing || this.listing.auctionFormat !== 'best-offer') return false;
    return this.isAuctionEnded();
  }

  acceptOffer(offer: Offer): void {
    if (this.offerActionLoadingId || !this.listing) return;
    this.offerActionLoadingId = offer._id;
    this.offersService.acceptOffer(offer._id).subscribe({
      next: () => {
        this.offerActionLoadingId = null;
        this.loadListing(this.route.snapshot.paramMap.get('slug') || '');
        Swal.fire({
          icon: 'success',
          title: 'Proposal Accepted!',
          text: 'The proposal has been accepted. Go to Transactions to manage and complete the sale.',
          showCancelButton: true,
          confirmButtonText: 'Go to Transactions',
          cancelButtonText: 'Stay here',
          confirmButtonColor: '#7A4F84',
          reverseButtons: true
        }).then(result => {
          if (result.isConfirmed) {
            this.router.navigate(['/dashboard/transactions']);
          }
        });
      },
      error: (err) => {
        this.offerActionLoadingId = null;
        if (err?.error?.error === 'Stripe not connected') {
          Swal.fire({
            icon: 'warning',
            title: 'Stripe Account Required',
            html: 'You must connect your Stripe account before accepting offers.<br><br>' +
              'Go to <strong>Dashboard → Settings → Payments</strong> to complete setup.',
            showCancelButton: true,
            confirmButtonText: 'Go to Settings',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#7A4F84',
            reverseButtons: true
          }).then(result => {
            if (result.isConfirmed) {
              this.router.navigate(['/dashboard/settings']);
            }
          });
        } else {
          this.offersError = err?.error?.message || 'Failed to accept offer.';
        }
      }
    });
  }

  /** True when the seller is allowed to decline this specific offer.
   *  Seller cannot decline an offer that meets the minimum price if it is the last qualifying pending offer. */
  canDeclineOffer(offer: Offer): boolean {
    if (!this.listing || !this.canSellerAcceptOrDeclineOffers()) return false;
    const min = this.listing.minimumOfferPrice ?? 0;
    if (min === 0 || offer.amount < min) return true;
    const pendingAboveMin = this.offers.filter(o => o.status === 'pending' && o.amount >= min);
    return pendingAboveMin.length > 1;
  }

  rejectOffer(offer: Offer): void {
    if (this.offerActionLoadingId || !this.listing) return;
    this.offerActionLoadingId = offer._id;
    this.offersService.rejectOffer(offer._id).subscribe({
      next: () => {
        this.offerActionLoadingId = null;
        // loadListing calls loadOffers internally for best-offer listings
        this.loadListing(this.route.snapshot.paramMap.get('slug') || '');
      },
      error: (err) => {
        this.offerActionLoadingId = null;
        this.offersError = err?.error?.message || 'Failed to reject offer.';
      }
    });
  }

  setActiveImage(index: number): void {
    this.activeImageIndex = index;
  }


  formatPrice(price: number): string {
    return `€ ${price.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  startCountdown(): void {
    // Clear any existing interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    this.countdownEnded = false;
    this.justEndedRefetched = false;

    // Calculate and display immediately
    this.updateCountdown();

    // Update every second
    this.countdownInterval = setInterval(() => {
      this.updateCountdown();
    }, 1000);
  }

  updateCountdown(): void {
    if (!this.listing) {
      this.countdownEnded = false;
      this.displayedTimeRemaining = '';
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
      this.countdownEnded = false;
      this.displayedTimeRemaining = '';
      return;
    }

    const now = new Date();
    const diff = endDate.getTime() - now.getTime();

    if (diff <= 0) {
      this.countdownEnded = true;
      this.displayedTimeRemaining = '';
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

    this.countdownEnded = false;

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
        parts.push(this.translate.instant('listingDetails.time.daysCount', { count: days }));
      }
      if (hours > 0) {
        parts.push(this.translate.instant('listingDetails.time.hoursCount', { count: hours }));
      }
      this.displayedTimeRemaining = parts.length > 0
        ? parts.join(' ')
        : this.translate.instant('listingDetails.time.endingSoon');
    }

    // Update winner selection countdown when auction ended and seller has 24h
    if (this.showWinnerSelectionCountdown()) {
      this.winnerSelectionCountdownDisplay = this.formatWinnerSelectionCountdown();
    } else {
      this.winnerSelectionCountdownDisplay = '';
    }

    this.cdr.markForCheck();
  }

  formatTimeRemaining(): string {
    if (this.countdownEnded || this.listing?.status === 'ended' || this.listing?.timeRemaining?.ended) {
      return this.translate.instant('listingDetails.time.endedShort');
    }
    if (this.displayedTimeRemaining) return this.displayedTimeRemaining;
    return this.translate.instant('listingDetails.time.na');
  }

  getAuctionEndType(): 'regular' | 'private-room' | 'ended' {
    if (!this.listing) return 'ended';
    if (this.listing.status === 'ended' || this.countdownEnded) return 'ended';
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

  /** True if we can show "Reopen" (ended with no bids for highest-bid, or no offers for best-offer). */
  canReopenListing(): boolean {
    if (!this.listing || !this.isOwnListing || !this.isAuctionEnded() || this.hasPrivateRoom()) return false;
    if (this.listing.auctionFormat === 'highest-bid') return this.getEndedBidCount() === 0;
    if (this.listing.auctionFormat === 'best-offer') return !this.offersLoading && this.offers.length === 0;
    return false;
  }

  /** Short closed message for best-offer (no offers vs has offers). */
  getBestOfferClosedMessage(): string {
    if (this.offers.length === 0) return 'Listing closed with no offers.';
    const accepted = this.offers.filter(o => o.status === 'accepted').length;
    if (accepted > 0) return `Listing closed. You have ${accepted} accepted offer${accepted > 1 ? 's' : ''}.`;
    return `Listing closed with ${this.offers.length} offer${this.offers.length !== 1 ? 's' : ''}.`;
  }

  /** True when this best-offer listing has at least one accepted offer (listing sold). */
  hasAcceptedOffer(): boolean {
    return this.offers.some(o => o.status === 'accepted');
  }

  /** True when seller has 24h to choose/accept winner and we should show the countdown (best-offer or highest-bid). */
  showWinnerSelectionCountdown(): boolean {
    if (this.listing?.status !== 'ended' || !this.listing?.winnerSelectionDeadline) return false;
    const deadline = new Date(this.listing.winnerSelectionDeadline);
    if (deadline <= new Date()) return false;
    if (this.listing.auctionFormat === 'best-offer') return !this.hasAcceptedOffer();
    return false;
  }

  /** Seconds remaining until winner selection deadline. */
  getWinnerSelectionSecondsRemaining(): number {
    if (!this.listing?.winnerSelectionDeadline) return 0;
    const diff = new Date(this.listing.winnerSelectionDeadline).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 1000));
  }

  /** Formatted countdown string for 24h winner selection (HH:MM:SS). */
  formatWinnerSelectionCountdown(): string {
    const sec = this.getWinnerSelectionSecondsRemaining();
    if (sec <= 0) return '00:00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /** True when auction ended with private room eligible and seller still has time to create the room. */
  showPrivateRoomEligibleCountdown(): boolean {
    if (this.listing?.status !== 'ended') return false;
    if (this.listing?.privateRoomStatus !== 'eligible') return false;
    if (!this.listing?.winnerSelectionDeadline) return false;
    return new Date(this.listing.winnerSelectionDeadline) > new Date();
  }

  /** Formatted MM:SS countdown for the 15-min private room creation window. */
  formatPrivateRoomEligibleCountdown(): string {
    if (!this.listing?.winnerSelectionDeadline) return '00:00';
    const diff = new Date(this.listing.winnerSelectionDeadline).getTime() - Date.now();
    const sec = Math.max(0, Math.floor(diff / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /** The accepted offer (for best-offer when seller has selected one). */
  get acceptedOffer(): Offer | null {
    return this.offers.find(o => o.status === 'accepted') ?? null;
  }

  /** Only registered, verified bidders can be selected as winner. */
  canSelectBidAsWinner(bid: Bid): boolean {
    return !!(bid.isAuthenticated && bid.bidderVerified);
  }

  /**
   * Highest bid per bidder (for seller modal). Backend accepts any bid id for that listing/bidder.
   */
  get aggregatedBidsForWinnerSelection(): Bid[] {
    const byKey = new Map<string, Bid>();
    for (const bid of this.bids) {
      const key =
        bid.bidder?._id?.toString() ||
        (bid.bidderEmail ? bid.bidderEmail.toLowerCase() : '') ||
        bid._id;
      const prev = byKey.get(key);
      if (!prev || bid.amount > prev.amount) {
        byKey.set(key, bid);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => b.amount - a.amount);
  }

  /** Manual winner selection via API is only allowed when private room is not enabled (see backend POST choose-winner). */
  canSellerSelectWinnerManually(): boolean {
    if (!this.listing || this.listing.auctionFormat !== 'highest-bid') return false;
    if (this.listing.status !== 'ended' || this.listing.winner) return false;
    if (this.listing.allowPrivateRoom) return false;
    if (this.isPrivateRoomEnded()) return false;
    return this.getEndedBidCount() > 0;
  }

  private isChooseWinnerEmailLink(): boolean {
    return (
      this.router.url.includes('/choose-winner') ||
      this.route.snapshot.queryParamMap.get('chooseWinner') === '1'
    );
  }

  /**
   * Handles seller email CTA `/listing/:slug/choose-winner` (and `?chooseWinner=1`).
   * Replaces URL with `/listing/:slug`, focuses Bid history, opens create-room or select-winner when applicable.
   */
  private handleChooseWinnerDeepLink(): void {
    if (this.chooseWinnerDeepLinkHandled || !this.isChooseWinnerEmailLink() || !this.listing?.slug) {
      return;
    }

    // Wait until Firebase auth state is confirmed before checking isAuthenticated.
    // The bids API response often arrives before onAuthStateChanged fires, which
    // would cause a false redirect to the login page for already-authenticated sellers.
    this.authService.authReady$.pipe(filter(ready => !!ready), take(1)).subscribe(() => {
      if (this.chooseWinnerDeepLinkHandled || !this.listing?.slug) return;
      this.chooseWinnerDeepLinkHandled = true;

      if (this.listing.auctionFormat === 'highest-bid') {
        this.setActiveTab('bids');
      }

      if (!this.isAuthenticated) {
        this.router.navigate(['/auth/login'], {
          queryParams: { returnUrl: `/listing/${this.listing.slug}?chooseWinner=1` }
        });
        return;
      }

      // Update the address bar without re-running the router (avoids remounting this view).
      this.location.replaceState(`/listing/${this.listing.slug}`);

      // Ensure isOwnListing is up to date now that auth is confirmed.
      this.updateIsOwnListing();

      if (!this.isOwnListing) {
        return;
      }

      if (this.canCreatePrivateRoom()) {
        this.openCreatePrivateRoomModal();
        return;
      }

      if (this.canSellerSelectWinnerManually()) {
        this.openSelectWinnerModal();
      }
    });
  }

  /** True if this bid is the winning bid. */
  isWinnerBid(bid: { _id: string }): boolean {
    if (!this.listing?.winnerBid) return false;
    const winnerBidId = typeof this.listing.winnerBid === 'string'
      ? this.listing.winnerBid
      : (this.listing.winnerBid as { _id?: string })?._id;
    return !!winnerBidId && bid._id === winnerBidId;
  }

  hasPrivateRoom(): boolean {
    return this.listing?.privateRoomStatus === 'active';
  }

  /** True when the authenticated user has an accepted invitation to this listing's private room. */
  isAcceptedPrivateRoomBidder(): boolean {
    return this.listing?.currentUserPlatinumStatus?.isPlatinumBidder === true;
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
    if (endType === 'private-room') {
      return this.translate.instant('listingDetails.time.privateRoomEnds');
    }
    if (endType === 'ended') {
      return this.listing?.auctionFormat === 'best-offer'
        ? this.translate.instant('listingDetails.time.listingEnded')
        : this.translate.instant('listingDetails.time.auctionEnded');
    }
    return this.listing?.auctionFormat === 'best-offer'
      ? this.translate.instant('listingDetails.time.offerDeadline')
      : this.translate.instant('listingDetails.time.auctionEnds');
  }

  categoryLabel(category: string): string {
    const key = `addListing.categories.${category}`;
    const t = this.translate.instant(key);
    return t !== key ? t : category;
  }

  subCategoryLabel(subCategory: string): string {
    const key = `addListing.subcategories.${subCategory}`;
    const t = this.translate.instant(key);
    return t !== key ? t : subCategory;
  }

  getReturnPolicyLabel(value: string): string {
    const keys: Record<string, string> = {
      '30-days': 'addListing.return30',
      '14-days': 'addListing.return14',
      '7-days': 'addListing.return7',
      'no-returns': 'addListing.returnNo',
      custom: 'addListing.returnCustom'
    };
    const key = keys[value];
    if (!key) return value || '';
    const t = this.translate.instant(key);
    return t !== key ? t : value;
  }

  getHandlingTimeLabel(days: number): string {
    const key = `addListing.handling${days}`;
    const t = this.translate.instant(key);
    return t !== key ? t : this.translate.instant('listingDetails.shipping.workingDaysCount', { count: days });
  }

  /** Item origin for the shipping section (location field or city/country). */
  listingLocation(): string {
    const l = this.listing;
    if (!l) return '';
    const full = l.location?.trim();
    if (full) return full;
    const city = l.locationCity?.trim();
    const country = l.locationCountry?.trim();
    if (city && country) return `${city}, ${country}`;
    return city || country || '';
  }

  setupRealTimeUpdates(listingId: string): void {
    // Clean up any previous real-time subs (e.g. called again after placing a bid)
    for (const sub of this.rtSubscriptions) sub.unsubscribe();
    this.rtSubscriptions = [];

    // Connect to Socket.io
    this.socketService.connect();

    // Join the listing room
    this.socketService.joinListing(listingId);

    // Subscribe to new offer / offer update events (Best Offer listings) - in-place merge + debounced refresh
    if (this.listing?.auctionFormat === 'best-offer') {
      const scheduleDebouncedRefresh = () => {
        if (this.offerRefreshDebounceTimer) clearTimeout(this.offerRefreshDebounceTimer);
        this.offerRefreshDebounceTimer = setTimeout(() => {
          this.offerRefreshDebounceTimer = null;
          this.loadOffers(listingId);
        }, this.OFFER_REFRESH_DEBOUNCE_MS);
      };

      const mergeOfferIntoList = (offer: Offer) => {
        const idx = this.offers.findIndex(o => o._id === offer._id);
        const merged: Offer = { ...offer, offererTier: offer.offererTier ?? null };
        if (idx >= 0) {
          this.offers = this.offers.map((o, i) => (i === idx ? merged : o));
        } else {
          this.offers = [merged, ...this.offers];
        }
        scheduleDebouncedRefresh();
      };

      const newOfferSubscription = this.socketService.onNewOffer().subscribe((event) => {
        if (event.listingId === listingId && event.offer) {
          mergeOfferIntoList(event.offer as Offer);
        }
      });
      this.rtSubscriptions.push(newOfferSubscription);

      const offerUpdateSubscription = this.socketService.onOfferUpdate().subscribe((event) => {
        if (event.listingId === listingId && event.offer) {
          mergeOfferIntoList(event.offer as Offer);
          if (event.listingStatus === 'ended' && this.listing) {
            this.listing.status = 'ended';
          }
        }
      });
      this.rtSubscriptions.push(offerUpdateSubscription);
    }

    // Subscribe to new bid events
    const newBidSubscription = this.socketService.onNewBid().subscribe((event) => {
      if (event.listingId !== listingId) return;
      // Add new bid to the list (prepend since we sort desc), capped to avoid unbounded growth
      const bidStr = String(event.bid?._id ?? '');
      const alreadyPresent = bidStr && this.bids.some(b => String(b._id) === bidStr);
      if (!alreadyPresent) {
        this.bids = [event.bid, ...this.bids].slice(0, MAX_DISPLAYED_BIDS);
      }
      // Update listing current price and bid count
      if (this.listing && event.currentPrice !== undefined && event.bidCount !== undefined) {
        this.listing.currentPrice = event.currentPrice;
        this.listing.bidCount = event.bidCount;
      }
      // Flash the new bid
      const newId = event.bid._id;
      this.newBidIds = new Set([...this.newBidIds, newId]);
      // Force immediate synchronous CD — eventCoalescing:true defers zone-triggered CD
      // which would leave the template stale until the next animation frame.
      this.cdr.markForCheck();
      this.cdr.detectChanges();
      setTimeout(() => {
        this.newBidIds.delete(newId);
        this.newBidIds = new Set(this.newBidIds);
        this.cdr.detectChanges();
      }, 2500);
    });
    this.rtSubscriptions.push(newBidSubscription);

    // Subscribe to listing update events (price, bid count changes, private room updates, auction end)
    const listingUpdateSubscription = this.socketService.onListingUpdate().subscribe((event) => {
      if (event.listingId === listingId && this.listing) {
        if (event.currentPrice !== undefined) this.listing.currentPrice = event.currentPrice;
        if (event.bidCount !== undefined) this.listing.bidCount = event.bidCount;

        if (event.privateRoomEndDate) {
          this.listing.privateRoomEndDate = event.privateRoomEndDate;
        }

        if (event.privateRoomStatus) {
          this.listing.privateRoomStatus = event.privateRoomStatus;
        }

        if (event.platinumBidderAcceptanceDeadline) {
          this.listing.platinumBidderAcceptanceDeadline = event.platinumBidderAcceptanceDeadline;
        }

        if (event.status) this.listing.status = event.status;
        if (event.winnerSelectionDeadline) this.listing.winnerSelectionDeadline = event.winnerSelectionDeadline;
        if (event.winner && this.listing?.slug) {
          this.loadListing(this.listing.slug);
        }

        this.startCountdown();
        this.cdr.detectChanges();
      }
    });
    this.rtSubscriptions.push(listingUpdateSubscription);
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
      if (!EMAIL_REGEX.test(trimmed)) {
        this.bidModalError = 'Please enter a valid email address.';
        return;
      }
      email = trimmed;
    }
    this.bidSubmitting = true;
    const bidData: { listingId: string; amount: number; bidType: 'manual'; notifyWhenOutbid: boolean; email?: string } = {
      listingId: this.listing._id,
      amount,
      bidType: 'manual',
      notifyWhenOutbid: this.bidNotifyWhenOutbid
    };
    if (!this.isAuthenticated && email) bidData.email = email;
    this.bidsService.createBid(bidData).pipe(
      timeout(45000),
      finalize(() => {
        this.bidSubmitting = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.closeBidModal();
        this.loadListing(this.listing!.slug); // loadListing already calls loadBids internally
        this.cdr.markForCheck();
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: 'Bid placed successfully!',
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true
        });
      },
      error: (err) => {
        if (err?.error?.error === 'kyc_required') {
          this.closeBidModal();
          this.kycService.openKycGate(err.error.kycStatus || 'none');
          return;
        }
        const msg = err?.error?.message || err?.message || 'Failed to place bid. Please try again.';
        this.bidModalError = msg;
        this.cdr.markForCheck();
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
    const min = this.listing.minimumOfferPrice ?? this.listing.startingPrice;
    this.offerAmount = min != null && min > 0 ? String(min) : '';
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

  /** Guest must provide a valid email; amount must parse to a positive number. */
  canSubmitOffer(): boolean {
    if (this.getOfferAmountNumber() <= 0) return false;
    if (!this.isAuthenticated) {
      const trimmed = (this.offerEmail || '').trim();
      if (!trimmed || !EMAIL_REGEX.test(trimmed)) return false;
    }
    return true;
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
      if (!EMAIL_REGEX.test(trimmed)) {
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
    this.offersService.createOffer(offerData).pipe(
      finalize(() => {
        this.offerSubmitting = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (created) => {
        this.closeOfferModal();
        if (this.listing?._id) this.loadOffers(this.listing._id);
        const wasAccepted = created?.status === 'accepted';
        if (wasAccepted && this.listing?.slug) {
          this.loadListing(this.listing.slug);
        }
        this.showOfferSuccessAlert(amount, wasAccepted);
      },
      error: (err) => {
        const msg = err.error?.message || this.translate.instant('listingDetails.offerModal.errorText');
        this.offerModalError = msg;
        this.cdr.markForCheck();
        void Swal.fire({
          icon: 'error',
          title: this.translate.instant('listingDetails.offerModal.errorTitle'),
          text: msg,
          confirmButtonText: this.translate.instant('listingDetails.offerModal.errorConfirm'),
          confirmButtonColor: '#C9A84C'
        });
      }
    });
  }

  private showOfferSuccessAlert(amount: number, wasAccepted: boolean): void {
    void Swal.fire({
      icon: 'success',
      title: this.translate.instant('listingDetails.offerModal.successTitle'),
      text: wasAccepted
        ? this.translate.instant('listingDetails.offerModal.successTextAccepted', {
            amount: this.formatPrice(amount)
          })
        : this.translate.instant('listingDetails.offerModal.successText'),
      confirmButtonText: this.translate.instant('listingDetails.offerModal.successConfirm'),
      confirmButtonColor: '#C9A84C',
      allowOutsideClick: false
    });
  }

  buyNow(): void {
    if (!this.listing) return;
    const listing = this.listing;
    Swal.fire({
      title: 'Buy Now',
      text: `Buy this item now for ${this.formatPrice(listing.buyNowPrice!)}? This will instantly close the auction.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Buy Now',
      confirmButtonColor: '#7A4F84',
      cancelButtonText: 'Cancel'
    }).then(result => {
      if (!result.isConfirmed) return;
      this.listingsService.buyNow(listing._id).subscribe({
        next: () => {
          Swal.fire({
            icon: 'success',
            title: 'Purchase successful!',
            text: 'Go to your transactions to complete payment.',
            confirmButtonText: 'Go to Payment',
            confirmButtonColor: '#7A4F84'
          }).then(() => {
            this.router.navigate(['/dashboard/transactions']);
          });
        },
        error: (err) => {
          Swal.fire({ icon: 'error', title: 'Purchase failed', text: err.error?.message || 'Failed to complete purchase', confirmButtonColor: '#7A4F84' });
        }
      });
    });
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

  loadSellerFollowStatus(sellerId: string): void {
    this.followService.getStatus(sellerId).subscribe({
      next: (status) => { this.sellerFollowStatus = status; },
      error: () => {}
    });
  }

  toggleFollowSeller(): void {
    const sellerId = (this.listing?.seller as any)?._id;
    if (!sellerId || this.followLoading) return;
    this.followLoading = true;
    const action = this.sellerFollowStatus.following
      ? this.followService.unfollow(sellerId)
      : this.followService.follow(sellerId);
    action.subscribe({
      next: (status) => { this.sellerFollowStatus = status; this.followLoading = false; },
      error: () => { this.followLoading = false; }
    });
  }

  toggleMuteSeller(): void {
    const sellerId = (this.listing?.seller as any)?._id;
    if (!sellerId || this.followLoading) return;
    this.followLoading = true;
    this.followService.setMuted(sellerId, !this.sellerFollowStatus.muted).subscribe({
      next: (status) => { this.sellerFollowStatus = status; this.followLoading = false; },
      error: () => { this.followLoading = false; }
    });
  }

  loadSellerBlockStatus(sellerId: string): void {
    this.blockService.getStatus(sellerId).subscribe({
      next: (status) => { this.sellerBlocked = status.blocked; },
      error: () => {}
    });
  }

  toggleBlockSeller(): void {
    const sellerId = (this.listing?.seller as any)?._id;
    if (!sellerId || this.blockLoading) return;
    this.blockLoading = true;
    const action = this.sellerBlocked
      ? this.blockService.unblock(sellerId)
      : this.blockService.block(sellerId);
    action.subscribe({
      next: (status) => { this.sellerBlocked = status.blocked; this.blockLoading = false; },
      error: () => { this.blockLoading = false; }
    });
  }

  updateIsOwnListing(): void {
    const currentUser = this.authService.getCurrentUser();
    if (!this.listing?.seller || !currentUser) {
      this.isOwnListing = false;
      this.sellerStripeReady = false;
      this.cdr.detectChanges();
      return;
    }
    const seller = this.listing.seller as { uid?: string; email?: string };
    if (seller.uid && currentUser.uid && seller.uid === currentUser.uid) {
      this.isOwnListing = true;
    } else if (
      currentUser.email &&
      seller.email &&
      currentUser.email.toLowerCase() === seller.email.toLowerCase()
    ) {
      this.isOwnListing = true;
    } else {
      this.isOwnListing = false;
    }
    if (!this.isOwnListing) {
      this.sellerStripeReady = false;
      this.cdr.detectChanges();
      return;
    }
    this.stripeConnectService.getAccountStatus().subscribe({
      next: (status) => {
        this.sellerStripeReady = status.connected && status.onboarded;
        this.cdr.detectChanges();
      },
      error: () => {
        this.sellerStripeReady = false;
        this.cdr.detectChanges();
      }
    });
    this.cdr.detectChanges();
  }

  /** Verified professional trader address lines for public display (API already sanitizes). */
  sellerVerifiedAddressLines(): string[] {
    const s = this.listing?.seller;
    if (!s || s.sellerClassification !== 'professional' || s.professionalVerificationStatus !== 'verified') {
      return [];
    }
    const parts: string[] = [];
    if (s.professionalAddressLine1?.trim()) parts.push(s.professionalAddressLine1.trim());
    if (s.professionalAddressLine2?.trim()) parts.push(s.professionalAddressLine2.trim());
    const cityLine = [s.professionalPostalCode, s.professionalCity].filter((x) => x && String(x).trim()).join(' ');
    if (cityLine) parts.push(cityLine);
    const regionCountry = [s.professionalRegion, s.professionalCountry].filter((x) => x && String(x).trim()).join(', ');
    if (regionCountry) parts.push(regionCountry);
    return parts;
  }

  goToBuyerTransactions(): void {
    this.router.navigate(['/dashboard/transactions']);
  }

  /** True when the current authenticated buyer is the chosen winner of this auction. */
  currentUserIsWinner(): boolean {
    if (!this.listing?.winner || !this.isAuthenticated || this.isOwnListing) return false;
    const currentUser = this.authService.getCurrentUser();
    const winner = this.listing.winner as { email?: string };
    return !!(currentUser?.email && winner?.email &&
      currentUser.email.toLowerCase() === winner.email.toLowerCase());
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
        Swal.fire({
          icon: 'success',
          title: 'Winner Selected!',
          text: 'The winner has been notified. Go to Transactions to manage and complete the sale.',
          showCancelButton: true,
          confirmButtonText: 'Go to Transactions',
          cancelButtonText: 'Stay here',
          confirmButtonColor: '#7A4F84',
          reverseButtons: true
        }).then(result => {
          if (result.isConfirmed) {
            this.router.navigate(['/dashboard/transactions']);
          }
        });
      },
      error: (err) => {
        this.selectingWinner = false;
        this.cdr.detectChanges();
        Swal.fire({ icon: 'error', title: 'Failed to select winner', text: err.error?.message || 'Please try again.', confirmButtonColor: '#7A4F84' });
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
        Swal.fire({ icon: 'error', title: 'Failed to reopen auction', text: err.error?.message || 'Please try again.', confirmButtonColor: '#7A4F84' });
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

  startPrivateRoomNow(): void {
    if (!this.listing?._id || this.privateRoomStartNowLoading) return;
    this.privateRoomStartNowLoading = true;
    this.privateRoomService.startRoomNow(this.listing._id).subscribe({
      next: (res) => {
        if (this.listing && res.listing) {
          const u = res.listing;
          if (u.status) this.listing.status = u.status as Listing['status'];
          if (u.privateRoomStatus) this.listing.privateRoomStatus = u.privateRoomStatus as Listing['privateRoomStatus'];
          if (u.privateRoomEndDate) this.listing.privateRoomEndDate = u.privateRoomEndDate;
          if (u.endDate) this.listing.endDate = u.endDate;
        }
        this.privateRoomStartNowLoading = false;
        this.startCountdown();
        this.cdr.detectChanges();
        this.openPrivateRoom();
      },
      error: (err) => {
        this.privateRoomStartNowLoading = false;
        this.cdr.detectChanges();
        Swal.fire({ icon: 'error', title: 'Failed to start room', text: err.error?.message || 'Please try again.', confirmButtonColor: '#7A4F84' });
      }
    });
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
    if (ids.length < 2 || ids.length > 5) {
      Swal.fire({ icon: 'warning', title: 'Invalid selection', text: 'Please select between 2 and 5 bidders for the private room.', confirmButtonColor: '#7A4F84' });
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
        // Refetch listing to populate platinumBidderStatus with invitation details
        if (this.listing?.slug) {
          this.listingsService.getListingBySlug(this.listing.slug).subscribe({
            next: (updated) => { this.listing = updated; this.cdr.detectChanges(); },
            error: () => {}
          });
        } else {
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        this.createPrivateRoomSubmitting = false;
        this.cdr.detectChanges();
        Swal.fire({ icon: 'error', title: 'Failed to create private room', text: err.error?.message || err.error?.error || 'Please try again.', confirmButtonColor: '#7A4F84' });
      }
    });
  }

  getDescriptionByline(): string {
    const d = this.listing?.description || '';
    return d.length > 180 ? d.slice(0, 180).trimEnd() + '…' : d;
  }

  /** Format a date string for display in bid/offer history (e.g. "Jan 5, 2025, 02:30 PM"). */
  formatDate(dateString: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(dateString));
  }

  /** @deprecated Use formatDate instead. */
  formatBidDate(dateString: string): string { return this.formatDate(dateString); }

  relativeTime(dateString: string): string {
    const diff = Date.now() - new Date(dateString).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return '';
  }

  bidBarWidth(bid: Bid): number {
    if (!this.bids.length) return 0;
    const max = this.bids[0]?.amount ?? 0;
    if (!max) return 100;
    return Math.round((bid.amount / max) * 100);
  }
  /** @deprecated Use formatDate instead. */
  formatOfferDate(dateString: string): string { return this.formatDate(dateString); }

  formatBidAmount(amount: number): string {
    return this.formatPrice(amount);
  }

  formatOfferStatus(status: string): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'accepted':
        return 'Accepted';
      case 'rejected':
        return 'Declined';
      case 'expired':
        return 'Expired';
      default:
        return status;
    }
  }

  /** Human-readable response line for an offer (who accepted/declined and when). */
  getOfferResponseLine(offer: Offer): string {
    if (offer.status === 'pending' || !offer.respondedAt) return '';
    const date = this.formatOfferDate(offer.respondedAt);
    if (this.isOwnListing) {
      return offer.status === 'accepted' ? `You accepted on ${date}` : `You declined on ${date}`;
    }
    return offer.status === 'accepted' ? `Accepted by seller on ${date}` : `Declined by seller on ${date}`;
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
    if (this.offerRefreshDebounceTimer) {
      clearTimeout(this.offerRefreshDebounceTimer);
      this.offerRefreshDebounceTimer = null;
    }

    // Unsubscribe from Socket.io events
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.rtSubscriptions.forEach(sub => sub.unsubscribe());
    this.rtSubscriptions = [];
    
    // Leave listing room and disconnect
    if (this.listing?._id) {
      this.socketService.leaveListing(this.listing._id);
    }
    // Note: Don't disconnect socket completely as it might be used by other components
    // this.socketService.disconnect();
    this.seo.resetToDefault();
  }

  // ── Share ────────────────────────────────────────────────────────────────────

  buildShareUrl(slug: string): string {
    // Use same-domain /api/share/... if the SWA has the backend linked (bidroom.pt/api/share/...)
    // Falls back to the direct backend URL for dev environments without linked backend
    const origin = window.location.origin;
    const isDev  = origin.includes('localhost') || origin.includes('azurestaticapps.net');
    if (isDev) {
      return `${API_CONFIG.getBackendBaseUrl()}/share/listing/${slug}`;
    }
    return `${origin}/api/share/listing/${slug}`;
  }

  async shareListing(): Promise<void> {
    if (!this.listing) return;
    const shareUrl = this.buildShareUrl(this.listing.slug);
    const price    = this.listing.currentPrice || this.listing.startingPrice || 0;
    const priceStr = `€${price.toLocaleString('pt-PT', { minimumFractionDigits: 0 })}`;
    const title    = `${this.listing.title} — BidRoom`;
    const text     = `${priceStr} · ${this.listing.auctionFormat === 'best-offer' ? 'Melhor Proposta' : 'Leilão'}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: shareUrl });
      } catch { /* cancelled by user */ }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      this.linkCopied = true;
      setTimeout(() => { this.linkCopied = false; }, 2500);
    }
  }
}

