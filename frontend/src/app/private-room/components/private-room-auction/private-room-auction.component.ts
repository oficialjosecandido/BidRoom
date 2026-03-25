import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService, Bid } from '../../../shared/services/bids.service';
import { SocketService } from '../../../shared/services/socket.service';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { PrivateRoomService } from '../../services/private-room.service';
import { API_CONFIG } from '../../../shared/config/api.config';

interface PlatinumBidderInfo {
  id: string;
  name: string;
  latestBid: number;
  bidCount: number;
}

@Component({
  selector: 'app-private-room-auction',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './private-room-auction.component.html',
  styleUrls: ['./private-room-auction.component.scss']
})
export class PrivateRoomAuctionComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private listingsService = inject(ListingsService);
  private bidsService = inject(BidsService);
  private socketService = inject(SocketService);
  private authService = inject(AuthService);
  private privateRoomService = inject(PrivateRoomService);

  listingId = '';
  listing: Listing | null = null;
  bids: Bid[] = [];
  platinumBidders: PlatinumBidderInfo[] = [];
  loading = true;
  error: string | null = null;
  countdown = 0; // seconds remaining
  isAuthenticated = false;
  isPlatinumBidder = false;
  /** Invited but not yet accepted; must accept within 15 min to place bids */
  invitationPending = false;
  currentUserId: string | null = null;
  currentUser: AppUser | null = null;
  viewerCount = 0;
  private socketSubscriptions: Subscription[] = [];
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private resizeHandler: () => void = () => this.checkMobile();
  isMobile = false;
  isPlacingBid = false;
  /** Custom bid amount (user can type any number >= min); empty = use minimum next bid */
  customBidAmount = '';
  bidInputError: string | null = null;
  startNowLoading = false;

  ngOnInit(): void {
    this.listingId = this.route.snapshot.paramMap.get('id') || '';

    // Wait for Firebase auth to initialise before fetching the listing so the
    // GET /listings/:id request carries the auth token and the backend returns
    // currentUserPlatinumStatus for the logged-in user.
    this.authService.authReady$.pipe(
      filter(ready => !!ready),
      take(1)
    ).subscribe(() => {
      if (this.listingId) {
        this.loadListing();
      }
    });

    this.socketSubscriptions.push(
      this.authService.currentUser$.subscribe(user => {
        const wasAuthenticated = this.isAuthenticated;
        this.isAuthenticated = !!user;
        this.currentUserId = user?.uid || null;
        this.currentUser = user;
        if (!user) {
          this.isPlatinumBidder = false;
          this.invitationPending = false;
        } else if (this.listing) {
          if (!wasAuthenticated && !this.listing.currentUserPlatinumStatus) {
            // Listing was loaded without auth; reload to get platinum status
            this.loadListing();
          } else {
            this.applyPlatinumStatusFromListing();
          }
        }
      })
    );

    // Detect mobile device
    this.checkMobile();
    window.addEventListener('resize', this.resizeHandler);
  }

  checkMobile(): void {
    this.isMobile = window.innerWidth < 769;
  }

  ngOnDestroy(): void {
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    window.removeEventListener('resize', this.resizeHandler);
    // Leave private room viewer room
    if (this.listingId) {
      this.socketService.leavePrivateRoomViewer(this.listingId);
      // If seller leaves, notify backend to close the room (fire-and-forget with keepalive)
      if (this.isSeller && (this.listing?.privateRoomStatus === 'active' || this.listing?.privateRoomStatus === 'invited')) {
        this.authService.getAccessToken().then((token) => {
          if (token) {
            const url = `${API_CONFIG.getApiUrl()}/private-room/listings/${this.listingId}/seller-leave`;
            fetch(url, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              keepalive: true
            }).catch(() => {});
          }
        });
      }
    }
  }

  getCurrentUserName(): string {
    if (!this.currentUser) return 'Guest';
    return this.currentUser.displayName || this.currentUser.email || 'User';
  }

  getCurrentUserInitials(): string {
    const name = this.currentUser?.displayName || this.currentUser?.email || '';
    return this.getInitial(name) || 'G';
  }

  loadListing(): void {
    this.loading = true;
    this.error = null;

    this.listingsService.getListingById(this.listingId).subscribe({
      next: (listing) => {
        this.listing = listing;
        this.loading = false;
        this.loadBids();
        this.applyPlatinumStatusFromListing();
        this.startCountdown();
        this.subscribeToUpdates();
      },
      error: (error) => {
        this.error = error?.message || 'Failed to load listing';
        this.loading = false;
      }
    });
  }

  loadBids(): void {
    if (!this.listingId) return;

    this.bidsService.getBidsByListing(this.listingId, 'desc').subscribe({
      next: (response) => {
        this.bids = response.bids;
        this.updatePlatinumBidders();
      },
      error: () => { /* bids load failure is non-critical; listing remains usable */ }
    });
  }

  updatePlatinumBidders(): void {
    if (!this.listing?.platinumBidders) {
      this.platinumBidders = [];
      return;
    }

    // Get unique platinum bidders with their latest bid info
    const platinumMap = new Map();
    
    this.listing.platinumBidders.forEach((pbId: string | { _id: string }) => {
      const bidderId = typeof pbId === 'string' ? pbId : pbId._id;
      // Find latest bid from this bidder
      const bidderBids = this.bids.filter(b => {
        if (b.bidder) {
          return (typeof b.bidder === 'string' ? b.bidder : b.bidder._id) === bidderId;
        }
        return false;
      });
      
      if (bidderBids.length > 0) {
        const latestBid = bidderBids.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];
        
        platinumMap.set(bidderId, {
          id: bidderId,
          name: latestBid.bidderName || latestBid.bidderFirstName + ' ' + latestBid.bidderLastName || 'Unknown',
          latestBid: latestBid.amount,
          bidCount: bidderBids.length
        });
      }
    });

    this.platinumBidders = Array.from(platinumMap.values());
  }

  startRoomNow(): void {
    if (!this.listingId || this.startNowLoading || !this.isSeller) return;
    this.startNowLoading = true;
    this.privateRoomService.startRoomNow(this.listingId).subscribe({
      next: (res) => {
        this.startNowLoading = false;
        if (res.listing && this.listing) {
          this.listing.privateRoomStatus = (res.listing.privateRoomStatus ?? 'active') as Listing['privateRoomStatus'];
          this.listing.privateRoomEndDate = res.listing.privateRoomEndDate ?? undefined;
          this.listing.status = (res.listing.status as Listing['status']) ?? this.listing.status;
          this.startCountdown();
        }
      },
      error: () => {
        this.startNowLoading = false;
      }
    });
  }

  /** Use currentUserPlatinumStatus from listing (from GET listing when authenticated). No separate API call needed. */
  applyPlatinumStatusFromListing(): void {
    const status = this.listing?.currentUserPlatinumStatus;
    if (status) {
      this.isPlatinumBidder = status.isPlatinumBidder ?? false;
      this.invitationPending = status.invitationPending ?? false;
      return;
    }
    this.isPlatinumBidder = false;
    this.invitationPending = false;
  }

  startCountdown(): void {
    const hasActiveCountdown = this.listing?.privateRoomStatus === 'active' && this.listing?.privateRoomEndDate;
    const hasAcceptanceCountdown = this.listing?.privateRoomStatus === 'invited' && this.listing?.platinumBidderAcceptanceDeadline;
    if (!hasActiveCountdown && !hasAcceptanceCountdown) return;

    this.updateCountdown();

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    this.countdownInterval = setInterval(() => {
      this.updateCountdown();
    }, 1000);
  }

  updateCountdown(): void {
    if (!this.listing) {
      this.countdown = 0;
      return;
    }

    let endDate: Date | null = null;
    if (this.listing.privateRoomStatus === 'invited' && this.listing.platinumBidderAcceptanceDeadline) {
      endDate = new Date(this.listing.platinumBidderAcceptanceDeadline);
    } else if (this.listing.privateRoomStatus === 'active' && this.listing.privateRoomEndDate) {
      endDate = new Date(this.listing.privateRoomEndDate);
    }

    if (!endDate) {
      this.countdown = 0;
      return;
    }

    const now = new Date();
    const remaining = Math.max(0, Math.floor((endDate.getTime() - now.getTime()) / 1000));
    this.countdown = remaining;

    if (remaining === 0 && this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
      // Listing-update socket event will deliver privateRoomStatus 'ended' when backend processes it
    }
  }

  formatCountdown(): string {
    if (this.countdown <= 0) return '00:00:00';
    
    const hours = Math.floor(this.countdown / 3600);
    const minutes = Math.floor((this.countdown % 3600) / 60);
    const seconds = this.countdown % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  subscribeToUpdates(): void {
    if (!this.listingId) return;

    // Join the listing room for socket events
    this.socketService.connect();
    this.socketService.joinListing(this.listingId);
    
    // Join private room viewer room to track viewers
    this.socketService.joinPrivateRoomViewer(this.listingId);

    // Subscribe to listing updates (filter by listingId) - update in-memory, no extra API calls
    const sub = this.socketService.onListingUpdate().subscribe(update => {
      if (update.listingId !== this.listingId || !this.listing) return;
      if (update.currentPrice !== undefined) this.listing.currentPrice = update.currentPrice;
      if (update.bidCount !== undefined) this.listing.bidCount = update.bidCount;
      if (update.privateRoomEndDate) {
        this.listing.privateRoomEndDate = update.privateRoomEndDate;
        this.startCountdown();
      }
      if (update.privateRoomClosedReason) {
        this.listing.privateRoomClosedReason = update.privateRoomClosedReason;
      }
      if (update.privateRoomStatus) {
        this.listing.privateRoomStatus = update.privateRoomStatus;
        if (update.privateRoomStatus === 'ended') {
          this.countdown = 0;
          if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
          }
          this.loadBids(); // Refresh bids for final state
        }
      }
      if (update.status) this.listing.status = update.status;
      if (update.endDate) this.listing.endDate = update.endDate;
      if (update.privateRoomStatus === 'active' || update.privateRoomStatus === 'invited') {
        this.startCountdown();
      }
    });

    this.socketSubscriptions.push(sub);

    // Subscribe to new bids (filter by listingId)
    const bidSub = this.socketService.onNewBid().subscribe(bidEvent => {
      if (bidEvent.listingId === this.listingId) {
        this.loadBids();
      }
    });

    this.socketSubscriptions.push(bidSub);

    // Subscribe to viewer count updates
    const viewerSub = this.socketService.onPrivateRoomViewerCountUpdate().subscribe(event => {
      if (event.listingId === this.listingId) {
        this.viewerCount = event.count;
      }
    });

    this.socketSubscriptions.push(viewerSub);
  }

  getMinBid(): number {
    if (!this.listing) return 0;
    const current = this.listing.currentPrice ?? 0;
    const increment = this.listing.bidIncrement ?? 1;
    return current + increment;
  }

  /** True if the current user is the listing seller (match by email). */
  get isSeller(): boolean {
    if (!this.currentUser?.email || !this.listing?.seller) return false;
    const seller = this.listing.seller as { email?: string };
    const sellerEmail = (seller.email || '').toLowerCase();
    const userEmail = (this.currentUser.email || '').toLowerCase();
    return !!sellerEmail && !!userEmail && sellerEmail === userEmail;
  }

  /** Temporary winner = bidder with the highest bid (by amount). */
  getTemporaryWinner(): { name: string; amount: number } | null {
    if (!this.bids.length) return null;
    const highest = this.bids.reduce((best, b) => (b.amount > best.amount ? b : best), this.bids[0]);
    const name = highest.bidderFirstName && highest.bidderLastName
      ? `${highest.bidderFirstName} ${highest.bidderLastName}`
      : (highest.bidderName || 'Bidder');
    return { name, amount: highest.amount };
  }

  /** URL to the listing page (for the header link). */
  getListingPageUrl(): string {
    const slug = this.listing?.slug;
    return slug ? `/listing/${slug}` : '#';
  }

  /** Seller clicks "Start auction" in center — scroll to Bid History (always visible; .prominent-bid-section is only for bidders). */
  onSellerStartAuction(): void {
    if (this.listing?.privateRoomStatus === 'active') {
      document.querySelector('#bid-history-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  placeBid(): void {
    if (!this.listing || this.isPlacingBid) return;

    const canBid = this.isPlatinumBidder && this.listing.privateRoomStatus === 'active';

    if (!canBid) {
      Swal.fire({
        icon: 'info',
        title: 'Cannot place bid',
        text: !this.isPlatinumBidder
          ? 'Only invited bidders (by the seller) can place bids. You can watch the room.'
          : 'Bidding is not currently available. The Private Room may have ended or is not yet active.',
        confirmButtonColor: '#7A4F84'
      });
      return;
    }

    const minBid = this.getMinBid();
    let amount: number;

    const trimmed = (this.customBidAmount || '').trim();
    if (trimmed !== '') {
      const parsed = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
      if (isNaN(parsed)) {
        this.bidInputError = 'Please enter a valid number.';
        return;
      }
      if (parsed < minBid) {
        this.bidInputError = `Your bid must be at least $${minBid.toFixed(2)} (current bid + increment).`;
        return;
      }
      amount = parsed;
    } else {
      amount = minBid;
    }

    this.bidInputError = null;
    this.isPlacingBid = true;

    this.bidsService.createBid({
      listingId: this.listing._id,
      amount
    }).subscribe({
      next: () => {
        this.isPlacingBid = false;
        this.customBidAmount = '';
        this.loadListing(); // loadListing calls loadBids internally
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: `Bid of $${amount.toFixed(2)} placed successfully!`,
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true
        });
      },
      error: (error) => {
        this.isPlacingBid = false;
        this.bidInputError = error?.error?.message || error?.message || 'Failed to place bid. Please try again.';
      }
    });
  }

  getBidderName(bidder: Bid): string {
    if (bidder.bidderFirstName && bidder.bidderLastName) {
      return `${bidder.bidderFirstName} ${bidder.bidderLastName}`;
    }
    return bidder.bidderName || bidder.bidderEmail || 'Guest Bidder';
  }

  getInitial(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  }

  getPositionTop(index: number): string {
    // Calculate angle for evenly spaced positions (72 degrees apart for 5 seats)
    const angle = (index * 72 - 90) * (Math.PI / 180); // Start at top (-90 degrees)
    
    // Responsive radius based on screen size
    const tableRadius = this.isMobile ? 160 : 225; // Half of table width
    const cardHalfSize = this.isMobile ? 55 : 75; // Half of card width
    const margin = this.isMobile ? 30 : 50;
    const radius = tableRadius + margin + cardHalfSize; // Distance from center to seat center
    const containerSize = this.isMobile ? Math.min(window.innerWidth - 32, 600) : 800; // Account for padding
    const centerY = containerSize / 2; // Center of bidder-positions container
    
    // Calculate position and subtract half card height to center it
    const y = centerY + Math.sin(angle) * radius - cardHalfSize;
    return `${y}px`;
  }

  getPositionLeft(index: number): string {
    // Calculate angle for evenly spaced positions
    const angle = (index * 72 - 90) * (Math.PI / 180);
    
    // Responsive radius based on screen size
    const tableRadius = this.isMobile ? 160 : 225;
    const cardHalfSize = this.isMobile ? 55 : 75;
    const margin = this.isMobile ? 30 : 50;
    const radius = tableRadius + margin + cardHalfSize;
    const containerSize = this.isMobile ? Math.min(window.innerWidth - 32, 600) : 800; // Account for padding
    const centerX = containerSize / 2;
    
    // Calculate position and subtract half card width to center it
    const x = centerX + Math.cos(angle) * radius - cardHalfSize;
    return `${x}px`;
  }

  getEmptySeats(): number[] {
    const totalSeats = 5;
    const usedSeats = this.platinumBidders.length;
    const emptySeatIndices: number[] = [];
    for (let i = usedSeats; i < totalSeats; i++) {
      emptySeatIndices.push(i);
    }
    return emptySeatIndices;
  }

  formatBidTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  navigateToLogin(): void {
    const returnUrl = this.router.url;
    this.router.navigate(['/auth/login'], { queryParams: { returnUrl } });
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/landing']),
      error: () => this.router.navigate(['/landing'])
    });
  }
}

