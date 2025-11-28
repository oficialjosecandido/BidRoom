import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { BidsService, Bid } from '../../../shared/services/bids.service';
import { SocketService } from '../../../shared/services/socket.service';
import { AuthService } from '../../../auth/services/auth.service';
import { PrivateRoomService } from '../../services/private-room.service';

@Component({
  selector: 'app-private-room-auction',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './private-room-auction.component.html',
  styleUrls: ['./private-room-auction.component.scss']
})
export class PrivateRoomAuctionComponent implements OnInit, OnDestroy {
  listingId: string = '';
  listing: Listing | null = null;
  bids: Bid[] = [];
  platinumBidders: any[] = [];
  loading = true;
  error: string | null = null;
  countdown: number = 0; // seconds remaining
  isAuthenticated = false;
  isPlatinumBidder = false;
  currentUserId: string | null = null;
  currentUser: any = null;
  viewerCount: number = 0;
  private socketSubscriptions: Subscription[] = [];
  private countdownInterval: any = null;
  isMobile: boolean = false;
  isPlacingBid: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private listingsService: ListingsService,
    private bidsService: BidsService,
    private socketService: SocketService,
    private authService: AuthService,
    private privateRoomService: PrivateRoomService
  ) {}

  ngOnInit(): void {
    this.listingId = this.route.snapshot.paramMap.get('id') || '';
    if (this.listingId) {
      this.loadListing();
    }

    // Check if user is authenticated and is a platinum bidder
    this.authService.currentUser$.subscribe(user => {
      const wasAuthenticated = this.isAuthenticated;
      this.isAuthenticated = !!user;
      this.currentUserId = user?.uid || null;
      this.currentUser = user;
      
      // Log for debugging
      console.log('Auth state changed:', { isAuthenticated: this.isAuthenticated, hasUser: !!user, listingId: this.listingId });
      
      if (user && this.listing) {
        // Re-check platinum status when auth state changes
        this.checkPlatinumBidderStatusFromBackend();
      } else if (!user) {
        this.isPlatinumBidder = false;
      }
    });

    // Detect mobile device
    this.checkMobile();
    window.addEventListener('resize', () => this.checkMobile());
  }

  checkMobile(): void {
    this.isMobile = window.innerWidth < 769;
  }

  ngOnDestroy(): void {
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    window.removeEventListener('resize', () => this.checkMobile());
    // Leave private room viewer room
    if (this.listingId) {
      this.socketService.leavePrivateRoomViewer(this.listingId);
    }
  }

  getCurrentUserName(): string {
    if (!this.currentUser) return 'Guest';
    return this.currentUser.displayName || this.currentUser.email || 'User';
  }

  getCurrentUserInitials(): string {
    if (!this.currentUser) return 'G';
    const name = this.currentUser.displayName || this.currentUser.email || '';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name[0]?.toUpperCase() || 'U';
  }

  loadListing(): void {
    this.loading = true;
    this.error = null;

    this.listingsService.getListing(this.listingId).subscribe({
      next: (listing) => {
        this.listing = listing;
        this.loading = false;
        this.loadBids();
        this.checkPlatinumBidderStatusFromBackend();
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
      error: (error) => {
        console.error('Failed to load bids:', error);
      }
    });
  }

  updatePlatinumBidders(): void {
    if (!this.listing?.platinumBidders) {
      this.platinumBidders = [];
      return;
    }

    // Get unique platinum bidders with their latest bid info
    const platinumMap = new Map();
    
    this.listing.platinumBidders.forEach((pbId: any) => {
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

  checkPlatinumBidderStatus(): void {
    if (!this.currentUserId || !this.listing?.platinumBidders) {
      this.isPlatinumBidder = false;
      return;
    }

    this.isPlatinumBidder = this.listing.platinumBidders.some((pbId: any) => {
      const bidderId = typeof pbId === 'string' ? pbId : pbId._id;
      return bidderId === this.currentUserId;
    });
  }

  checkPlatinumBidderStatusFromBackend(): void {
    if (!this.listingId || !this.isAuthenticated) {
      this.isPlatinumBidder = false;
      console.log('Platinum check skipped:', { listingId: this.listingId, isAuthenticated: this.isAuthenticated });
      return;
    }

    // Check with backend API to get accurate status
    console.log('Checking platinum bidder status from backend...');
    this.privateRoomService.checkPlatinumBidderStatus(this.listingId).subscribe({
      next: (response) => {
        console.log('Platinum bidder status response:', response);
        this.isPlatinumBidder = response.isPlatinumBidder;
        if (response.needsAcceptance) {
          console.warn('User needs to accept invitation:', response);
        }
      },
      error: (error) => {
        console.error('Error checking platinum bidder status:', error);
        this.isPlatinumBidder = false;
        // Fallback to frontend check
        this.checkPlatinumBidderStatus();
      }
    });
  }

  startCountdown(): void {
    if (!this.listing?.privateRoomEndDate) return;

    this.updateCountdown();
    
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    this.countdownInterval = setInterval(() => {
      this.updateCountdown();
    }, 1000);
  }

  updateCountdown(): void {
    if (!this.listing?.privateRoomEndDate) {
      this.countdown = 0;
      return;
    }

    const endDate = new Date(this.listing.privateRoomEndDate);
    const now = new Date();
    const remaining = Math.max(0, Math.floor((endDate.getTime() - now.getTime()) / 1000));
    
    this.countdown = remaining;

    if (remaining === 0) {
      this.loadListing(); // Reload to check if room ended
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

    // Subscribe to listing updates (filter by listingId)
    const sub = this.socketService.onListingUpdate().subscribe(update => {
      if (update.listingId === this.listingId && this.listing) {
        this.listing.currentPrice = update.currentPrice;
        this.listing.bidCount = update.bidCount;
        if (update.privateRoomEndDate) {
          this.listing.privateRoomEndDate = update.privateRoomEndDate;
          this.startCountdown();
        }
        if (update.privateRoomStatus) {
          this.listing.privateRoomStatus = update.privateRoomStatus;
        }
        this.loadBids(); // Reload bids to get latest
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
        console.log(`Viewer count updated: ${event.count} viewers`);
      }
    });

    this.socketSubscriptions.push(viewerSub);
  }

  placeBid(): void {
    if (!this.listing || !this.isPlatinumBidder || this.isPlacingBid) return;

    // Get current price and calculate next bid
    const currentPrice = this.listing.currentPrice;
    const bidIncrement = this.listing.bidIncrement || 1;
    const nextBid = currentPrice + bidIncrement;

    if (!confirm(`Place bid of $${nextBid.toFixed(2)}? This will extend the auction deadline by 30 seconds.`)) {
      return;
    }

    this.isPlacingBid = true;

    this.bidsService.createBid({
      listingId: this.listing._id,
      amount: nextBid
    }).subscribe({
      next: () => {
        this.isPlacingBid = false;
        this.loadBids();
        this.loadListing();
        // Show success message
        const successMsg = document.createElement('div');
        successMsg.className = 'bid-success-toast';
        successMsg.textContent = `✓ Bid of $${nextBid.toFixed(2)} placed successfully!`;
        document.body.appendChild(successMsg);
        setTimeout(() => {
          successMsg.classList.add('show');
        }, 100);
        setTimeout(() => {
          successMsg.classList.remove('show');
          setTimeout(() => document.body.removeChild(successMsg), 300);
        }, 3000);
      },
      error: (error) => {
        this.isPlacingBid = false;
        alert(error?.error?.message || error?.message || 'Failed to place bid. Please try again.');
      }
    });
  }

  getBidderName(bidder: any): string {
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
      next: () => {
        this.router.navigate(['/landing']);
      },
      error: (error) => {
        console.error('Logout error:', error);
        // Still navigate even if logout has an error
        this.router.navigate(['/landing']);
      }
    });
  }
}

