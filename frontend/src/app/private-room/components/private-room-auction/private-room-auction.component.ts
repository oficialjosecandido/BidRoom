import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { API_CONFIG } from '../../../shared/config/api.config';
import { getLocalizedTitle } from '../../../shared/utils/listing-locale';
import { PostHogService } from '../../../shared/services/posthog.service';
import { AnalyticsEvents } from '../../../shared/services/analytics.events';
import { CurrencyDisplayService } from '../../../shared/services/currency-display.service';
import { DisplayPricePipe } from '../../../shared/pipes/display-price.pipe';

type InvitationDisplayStatus = 'pending' | 'accepted' | 'declined';

interface PlatinumBidderInfo {
  id: string;
  name: string;
  latestBid: number;
  bidCount: number;
  /** RSVP from platinumBidderInvitations */
  invitationStatus: InvitationDisplayStatus;
}

@Component({
  selector: 'app-private-room-auction',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, DisplayPricePipe],
  templateUrl: './private-room-auction.component.html',
  styleUrls: ['./private-room-auction.component.scss']
})
export class PrivateRoomAuctionComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private listingsService = inject(ListingsService);
  private bidsService = inject(BidsService);
  private socketService = inject(SocketService);
  private authService = inject(AuthService);
  private privateRoomService = inject(PrivateRoomService);
  private postHog = inject(PostHogService);
  private translate = inject(TranslateService);
  readonly currencyService = inject(CurrencyDisplayService);

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
  /** Real-time socket subs — tracked separately so re-entering subscribeToUpdates() doesn't stack duplicates. */
  private rtSubscriptions: Subscription[] = [];
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private expiryPollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Avoid showing the auction-ENDED modal more than once per page visit. */
  private sessionEndModalShown = false;
  /** Avoid showing the "room started" toast more than once. */
  private invitedStartedShown = false;
  /** Status when the local countdown first hit zero (before backend catches up). */
  private expiredAtStatus: 'active' | 'invited' | null = null;
  isPlacingBid = false;
  /** Custom bid amount (user can type any number >= min); empty = use minimum next bid */
  customBidAmount = '';
  bidInputError: string | null = null;
  startNowLoading = false;
  acceptingInvitation = false;
  selectedImageIndex = 0;
  Math = Math;

  get currentLang(): string {
    return this.translate.currentLang || 'pt';
  }

  get isInvitedBidder(): boolean {
    return this.isPlatinumBidder;
  }

  switchLanguage(code: string): void {
    this.translate.use(code);
    localStorage.setItem('lang', code);
  }

  get localizedListingTitle(): string {
    if (!this.listing) return '';
    return getLocalizedTitle(this.listing, this.translate.currentLang || 'pt');
  }

  ngOnInit(): void {
    const savedLang = localStorage.getItem('lang') || 'pt';
    this.translate.use(savedLang);

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

  }

  ngOnDestroy(): void {
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.rtSubscriptions.forEach(sub => sub.unsubscribe());
    this.rtSubscriptions = [];
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.expiryPollTimer) {
      clearTimeout(this.expiryPollTimer);
      this.expiryPollTimer = null;
    }
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
    const platinumMap = new Map<string, PlatinumBidderInfo>();

    // Seed all invited bidders (accepted or pending) from invitation status
    const invitations = this.listing?.platinumBidderStatus || [];
    for (const inv of invitations) {
      const bidderId = inv.bidder._id;
      const name = [inv.bidder.firstName, inv.bidder.lastName].filter(Boolean).join(' ') || 'Invited Bidder';
      const st = inv.status;
      const invitationStatus: InvitationDisplayStatus =
        st === 'declined' ? 'declined' : st === 'accepted' ? 'accepted' : 'pending';
      platinumMap.set(bidderId, {
        id: bidderId,
        name,
        latestBid: 0,
        bidCount: 0,
        invitationStatus
      });
    }

    // Overlay actual bid data
    for (const b of this.bids) {
      if (!b.bidder) continue;
      const bidderId = typeof b.bidder === 'string' ? b.bidder : b.bidder._id;
      const existing = platinumMap.get(bidderId);
      if (!existing) continue; // only show platinum invitees
      const bidDate = new Date(b.createdAt).getTime();
      const existingDate = existing.bidCount > 0
        ? new Date(this.bids.find(x => {
            const xId = typeof x.bidder === 'string' ? x.bidder : x.bidder?._id;
            return xId === bidderId && x.amount === existing.latestBid;
          })?.createdAt || 0).getTime()
        : 0;
      if (bidDate >= existingDate) {
        const name = b.bidderName || [b.bidderFirstName, b.bidderLastName].filter(Boolean).join(' ') || existing.name;
        platinumMap.set(bidderId, {
          ...existing,
          name,
          latestBid: b.amount > existing.latestBid ? b.amount : existing.latestBid,
          bidCount: existing.bidCount + 1
          // Keep invitationStatus from platinumBidderStatus only — do not infer from bids:
          // main-auction bids would wrongly mark invitees as "accepted" before they RSVP.
        });
      }
    }

    this.platinumBidders = Array.from(platinumMap.values());
  }

  acceptInvitationInPage(): void {
    if (!this.listingId || this.acceptingInvitation) return;
    this.acceptingInvitation = true;
    this.privateRoomService.acceptInvitationInPage(this.listingId).subscribe({
      next: () => {
        this.acceptingInvitation = false;
        this.invitationPending = false;
        this.isPlatinumBidder = true;
        this.postHog.track(AnalyticsEvents.PRIVATE_ROOM_INVITE_ACCEPTED, {
          listing_id: this.listingId,
          listing_slug: this.listing?.slug ?? '',
          item_category: this.listing?.category ?? '',
        });
        // Refresh listing data so the UI reflects the latest room state
        // (e.g. privateRoomStatus may have changed, or we need accurate platinumBidderStatus)
        this.loadListing();
      },
      error: (err) => {
        this.acceptingInvitation = false;
        Swal.fire({
          icon: 'error',
          title: 'Could not accept',
          text: err?.error?.message || 'Failed to accept invitation. Please try the email link.',
          confirmButtonColor: '#7A4F84'
        });
      }
    });
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
          this.listing.endDate = res.listing.endDate ?? this.listing.endDate;
          this.listing.status = (res.listing.status as Listing['status']) ?? this.listing.status;
          this.startCountdown();
          this.loadListing();
        }
      },
      error: () => {
        this.startNowLoading = false;
        Swal.fire({
          icon: 'error',
          title: 'Could not start',
          text: 'The room could not be started. It may have already started or ended.',
          confirmButtonColor: '#7A4F84'
        });
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
    const wasPositive = this.countdown > 0;
    this.countdown = remaining;

    if (wasPositive && remaining === 0) {
      this.onLocalCountdownReachedZero();
    }

    if (remaining === 0 && this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  /** True while the active bidding window is open (blocks bid UI after expiry). */
  get isBiddingOpen(): boolean {
    return (
      this.listing?.privateRoomStatus === 'active' &&
      this.countdown > 0
    );
  }

  private onLocalCountdownReachedZero(): void {
    if (!this.listing || this.sessionEndModalShown) return;
    const status = this.listing.privateRoomStatus;
    if (status !== 'active' && status !== 'invited') return;

    this.expiredAtStatus = status;
    this.refreshListingAfterExpiry(0);
  }

  private refreshListingAfterExpiry(attempt: number): void {
    if (!this.listingId) return;

    this.listingsService.getListingById(this.listingId).subscribe({
      next: (listing) => {
        this.listing = listing;
        this.applyPlatinumStatusFromListing();
        this.loadBids();
        this.startCountdown();
        this.cdr.detectChanges();

        if (this.tryPresentSessionEndModal(listing)) {
          return;
        }

        // Backend scheduler may take up to ~1 minute; poll until state settles.
        if (attempt < 15) {
          if (this.expiryPollTimer) clearTimeout(this.expiryPollTimer);
          this.expiryPollTimer = setTimeout(
            () => this.refreshListingAfterExpiry(attempt + 1),
            5000
          );
        } else if (this.listing) {
          this.presentSessionEndModal(this.listing, true);
        }
      },
      error: () => {
        if (this.listing) {
          this.presentSessionEndModal(this.listing, true);
        }
      }
    });
  }

  /** Returns true when the modal was shown (or already shown). */
  private tryPresentSessionEndModal(listing: Listing): boolean {
    if (this.sessionEndModalShown) return true;

    const phase = this.expiredAtStatus;
    if (phase === 'active') {
      if (listing.privateRoomStatus === 'ended') {
        this.presentSessionEndModal(listing);
        return true;
      }
      return false;
    }
    if (phase === 'invited') {
      if (listing.privateRoomStatus === 'active') {
        // Room just auto-started after acceptance window — show a non-blocking toast
        // so bidding remains open. Do NOT call presentSessionEndModal here.
        if (!this.invitedStartedShown) {
          this.invitedStartedShown = true;
          this.expiredAtStatus = null;
          if (this.expiryPollTimer) { clearTimeout(this.expiryPollTimer); this.expiryPollTimer = null; }
          this.startCountdown();
          Swal.fire({
            toast: true,
            position: 'top',
            icon: 'success',
            title: this.translate.instant('privateRoomAuction.expired.titleStarted'),
            html: this.isPlatinumBidder
              ? this.translate.instant('privateRoomAuction.expired.bodyStartedInvited')
              : this.translate.instant('privateRoomAuction.expired.bodyStartedOther'),
            showConfirmButton: false,
            timer: 5000,
            timerProgressBar: true
          });
        }
        return true;
      }
      if (listing.privateRoomStatus === 'ended') {
        this.presentSessionEndModal(listing);
        return true;
      }
      return false;
    }

    if (listing.privateRoomStatus === 'ended') {
      this.presentSessionEndModal(listing);
      return true;
    }
    return false;
  }

  private presentSessionEndModal(listing: Listing, confirming = false): void {
    if (this.sessionEndModalShown) return;
    this.sessionEndModalShown = true;
    const phaseAtExpiry = this.expiredAtStatus;
    this.expiredAtStatus = null;

    const winner = this.getTemporaryWinner();
    if (this.isSeller && winner) {
      this.postHog.track(AnalyticsEvents.PRIVATE_ROOM_WON, {
        listing_id: listing._id,
        listing_slug: listing.slug,
        item_category: listing.category,
        final_price: winner.amount,
        participants: this.platinumBidders.length,
      });
    }

    const content = this.buildSessionEndModalContent(listing, confirming, phaseAtExpiry);
    const listingUrl = this.getListingPageUrl();

    Swal.fire({
      icon: content.icon,
      title: content.title,
      html: content.html,
      confirmButtonText: content.confirmText,
      confirmButtonColor: '#c9a84c',
      showCancelButton: content.showViewListing,
      cancelButtonText: this.translate.instant('privateRoomAuction.expired.viewListing'),
      cancelButtonColor: '#6b7280',
      allowOutsideClick: false,
      allowEscapeKey: true,
      customClass: {
        popup: 'pr-expiry-modal',
        confirmButton: 'pr-expiry-modal__confirm',
      },
    }).then((result) => {
      if (result.isConfirmed && content.navigateToTransactions) {
        this.router.navigate(['/dashboard/transactions']);
        return;
      }
      if (result.dismiss === Swal.DismissReason.cancel && content.showViewListing && listingUrl !== '#') {
        window.open(listingUrl, '_blank', 'noopener,noreferrer');
      }
    });
  }

  private buildSessionEndModalContent(
    listing: Listing,
    confirming: boolean,
    phaseAtExpiry: 'active' | 'invited' | null = null
  ): {
    icon: 'info' | 'success' | 'warning';
    title: string;
    html: string;
    confirmText: string;
    showViewListing: boolean;
    navigateToTransactions: boolean;
  } {
    const t = (key: string, params?: Record<string, string>) =>
      this.translate.instant(`privateRoomAuction.expired.${key}`, params);

    const winner = this.getTemporaryWinner();
    const amount = winner ? this.formatEur(winner.amount) : '';
    const name = winner?.name ?? '';
    const params = { amount, name: this.escapeHtml(name) };

    if (confirming) {
      return {
        icon: 'info',
        title: t('titleEnded'),
        html: t('bodyConfirming'),
        confirmText: t('confirm'),
        showViewListing: listing.slug != null,
        navigateToTransactions: false,
      };
    }

    if (listing.privateRoomStatus === 'active' && phaseAtExpiry === 'invited') {
      return {
        icon: 'success',
        title: t('titleStarted'),
        html: this.isPlatinumBidder ? t('bodyStartedInvited') : t('bodyStartedOther'),
        confirmText: t('confirm'),
        showViewListing: false,
        navigateToTransactions: false,
      };
    }

    if (listing.privateRoomClosedReason === 'no_acceptances') {
      return {
        icon: 'warning',
        title: t('titleClosed'),
        html: t('bodyNoAccept'),
        confirmText: t('confirm'),
        showViewListing: listing.slug != null,
        navigateToTransactions: false,
      };
    }

    if (listing.privateRoomClosedReason === 'seller_left') {
      return {
        icon: 'warning',
        title: t('titleClosed'),
        html: t('bodySellerLeft'),
        confirmText: t('confirm'),
        showViewListing: listing.slug != null,
        navigateToTransactions: false,
      };
    }

    if (this.isCurrentUserWinner(listing)) {
      return {
        icon: 'success',
        title: t('titleEnded'),
        html: t('bodyWinner', params),
        confirmText: t('viewTransactions'),
        showViewListing: true,
        navigateToTransactions: true,
      };
    }

    if (this.isSeller) {
      return {
        icon: 'info',
        title: t('titleEnded'),
        html: winner ? t('bodySellerWithWinner', params) : t('bodySellerNoWinner'),
        confirmText: t('confirm'),
        showViewListing: listing.slug != null,
        navigateToTransactions: false,
      };
    }

    if (this.isPlatinumBidder) {
      return {
        icon: 'info',
        title: t('titleEnded'),
        html: winner ? t('bodyParticipantWithWinner', params) : t('bodyParticipantNoWinner'),
        confirmText: t('confirm'),
        showViewListing: listing.slug != null,
        navigateToTransactions: false,
      };
    }

    return {
      icon: 'info',
      title: t('titleEnded'),
      html: winner ? t('bodySpectatorWithWinner', params) : t('bodySpectatorNoWinner'),
      confirmText: t('confirm'),
      showViewListing: listing.slug != null,
      navigateToTransactions: false,
    };
  }

  /** Static ended-page content (i18n), aligned with the session-end modal logic. */
  get endedPageView(): {
    title: string;
    bodyHtml: string;
    tone: 'success' | 'warning' | 'info';
    showTransactions: boolean;
    winnerName: string;
    winnerAmount: string;
  } | null {
    const listing = this.listing;
    if (!listing || listing.privateRoomStatus !== 'ended') return null;

    const t = (key: string, params?: Record<string, string>) =>
      this.translate.instant(`privateRoomAuction.expired.${key}`, params);

    const winner = this.getTemporaryWinner();
    const winnerAmount = winner ? this.formatEur(winner.amount) : '';
    const winnerName = winner?.name ?? '';
    const params = { amount: winnerAmount, name: this.escapeHtml(winnerName) };

    if (listing.privateRoomClosedReason === 'no_acceptances') {
      return { title: t('titleClosed'), bodyHtml: t('bodyNoAccept'), tone: 'warning', showTransactions: false, winnerName, winnerAmount };
    }
    if (listing.privateRoomClosedReason === 'seller_left') {
      return { title: t('titleClosed'), bodyHtml: t('bodySellerLeft'), tone: 'warning', showTransactions: false, winnerName, winnerAmount };
    }
    if (this.isCurrentUserWinner(listing)) {
      return { title: t('titleEnded'), bodyHtml: t('bodyWinner', params), tone: 'success', showTransactions: true, winnerName, winnerAmount };
    }
    if (this.isSeller) {
      return {
        title: t('titleEnded'),
        bodyHtml: winner ? t('bodySellerWithWinner', params) : t('bodySellerNoWinner'),
        tone: 'info',
        showTransactions: false,
        winnerName,
        winnerAmount,
      };
    }
    if (this.isInvitedBidder) {
      return {
        title: t('titleEnded'),
        bodyHtml: winner ? t('bodyParticipantWithWinner', params) : t('bodyParticipantNoWinner'),
        tone: 'info',
        showTransactions: false,
        winnerName,
        winnerAmount,
      };
    }
    return {
      title: t('titleEnded'),
      bodyHtml: winner ? t('bodySpectatorWithWinner', params) : t('bodySpectatorNoWinner'),
      tone: 'info',
      showTransactions: false,
      winnerName,
      winnerAmount,
    };
  }

  navigateToTransactions(): void {
    this.router.navigate(['/dashboard/transactions']);
  }

  private isCurrentUserWinner(listing: Listing): boolean {
    const email = this.currentUser?.email?.toLowerCase();
    if (!email) return false;
    if (listing.winner?.email && listing.winner.email.toLowerCase() === email) {
      return true;
    }
    const top = this.getTemporaryWinner();
    if (!top || !this.currentUser?.email) return false;
    const topBid = this.bids.find(b => b.amount === top.amount);
    if (topBid?.bidderEmail && topBid.bidderEmail.toLowerCase() === email) return true;
    return false;
  }

  private onPrivateRoomEndedFromServer(): void {
    if (!this.listing) return;
    this.countdown = 0;
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.expiryPollTimer) {
      clearTimeout(this.expiryPollTimer);
      this.expiryPollTimer = null;
    }
    this.loadBids();
    if (!this.sessionEndModalShown) {
      this.presentSessionEndModal(this.listing);
    }
    this.cdr.detectChanges();
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

    // Clean up previous RT subs before re-subscribing (loadListing calls this on every refresh)
    for (const s of this.rtSubscriptions) s.unsubscribe();
    this.rtSubscriptions = [];

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
      if (update.platinumBidderAcceptanceDeadline) {
        this.listing.platinumBidderAcceptanceDeadline = update.platinumBidderAcceptanceDeadline;
        this.startCountdown();
      }
      if (update.privateRoomStatus) {
        const prevStatus = this.listing.privateRoomStatus;
        this.listing.privateRoomStatus = update.privateRoomStatus;
        if (update.privateRoomStatus === 'ended' && prevStatus !== 'ended') {
          this.onPrivateRoomEndedFromServer();
        }
        // Acceptance window expired and backend auto-started the room via the scheduler.
        // Stop any expiry polling and show a non-blocking toast so bidding can begin.
        if (update.privateRoomStatus === 'active' && prevStatus === 'invited') {
          if (this.expiryPollTimer) { clearTimeout(this.expiryPollTimer); this.expiryPollTimer = null; }
          this.expiredAtStatus = null;
          if (!this.invitedStartedShown) {
            this.invitedStartedShown = true;
            if (update.privateRoomEndDate) this.listing.privateRoomEndDate = update.privateRoomEndDate;
            Swal.fire({
              toast: true,
              position: 'top',
              icon: 'success',
              title: this.translate.instant('privateRoomAuction.expired.titleStarted'),
              html: this.isPlatinumBidder
                ? this.translate.instant('privateRoomAuction.expired.bodyStartedInvited')
                : this.translate.instant('privateRoomAuction.expired.bodyStartedOther'),
              showConfirmButton: false,
              timer: 5000,
              timerProgressBar: true
            });
          }
        }
      }
      if (update.status) this.listing.status = update.status;
      if (update.endDate) this.listing.endDate = update.endDate;
      if (update.privateRoomStatus === 'active' || update.privateRoomStatus === 'invited') {
        this.startCountdown();
      }
      this.cdr.detectChanges();
    });

    this.rtSubscriptions.push(sub);

    // Subscribe to new bids — update in-place immediately from socket data (no HTTP round-trip)
    const bidSub = this.socketService.onNewBid().subscribe(bidEvent => {
      if (bidEvent.listingId !== this.listingId) return;
      if (!this.bids.some(b => b._id === bidEvent.bid._id)) {
        this.bids = [bidEvent.bid, ...this.bids];
      }
      if (this.listing) {
        if (bidEvent.currentPrice !== undefined) this.listing.currentPrice = bidEvent.currentPrice;
        if (bidEvent.bidCount !== undefined) this.listing.bidCount = bidEvent.bidCount;
      }
      this.updatePlatinumBidders();
      // Force synchronous CD — eventCoalescing:true defers zone-triggered CD
      this.cdr.detectChanges();
    });

    this.rtSubscriptions.push(bidSub);

    // Subscribe to viewer count updates
    const viewerSub = this.socketService.onPrivateRoomViewerCountUpdate().subscribe(event => {
      if (event.listingId === this.listingId) {
        this.viewerCount = event.count;
        this.cdr.detectChanges();
      }
    });

    this.rtSubscriptions.push(viewerSub);

    // Update seat status live when a bidder accepts the invitation
    const acceptSub = this.socketService.onInvitationAccepted().subscribe(event => {
      if (event.listingId !== this.listingId || !event.bidderId) return;
      const existing = this.platinumBidders.find(b => b.id === event.bidderId);
      if (existing) {
        existing.invitationStatus = 'accepted';
        existing.name = event.bidderName || existing.name;
      } else {
        const name = event.bidderName || [event.bidderFirstName, event.bidderLastName].filter(Boolean).join(' ') || 'Invited Bidder';
        this.platinumBidders = [...this.platinumBidders, {
          id: event.bidderId,
          name,
          latestBid: 0,
          bidCount: 0,
          invitationStatus: 'accepted'
        }];
      }
      // Reload listing for other participants so their view of invitation statuses stays current
      // (self-acceptance already calls loadListing() in acceptInvitationInPage())
      const isSelf = event.bidderId === this.currentUserId;
      if (!isSelf) {
        this.loadListing();
      }
    });

    this.rtSubscriptions.push(acceptSub);

    const declineSub = this.socketService.onInvitationDeclined().subscribe(event => {
      if (event.listingId !== this.listingId || !event.bidderId) return;
      const existing = this.platinumBidders.find(b => b.id === event.bidderId);
      if (existing) {
        existing.invitationStatus = 'declined';
        this.platinumBidders = [...this.platinumBidders];
      } else {
        this.loadListing();
      }
    });

    this.rtSubscriptions.push(declineSub);
  }

  /** Badge label for invitation RSVP */
  invitationLabel(b: PlatinumBidderInfo): string {
    switch (b.invitationStatus) {
      case 'accepted':
        return 'Accepted';
      case 'declined':
        return 'Declined';
      default:
        return 'Pending';
    }
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

  /** Display name of the listing seller (for the participants panel). */
  get sellerDisplayName(): string {
    if (!this.listing?.seller) return 'Seller';
    const s = this.listing.seller as { firstName?: string; lastName?: string };
    return [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Seller';
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

  /**
   * Seller: during invitation phase, starts the private room immediately (same as listing-details).
   * When already active, scrolls to bid history.
   */
  onSellerStartAuction(): void {
    if (this.listing?.privateRoomStatus === 'invited') {
      this.startRoomNow();
      return;
    }
    if (this.listing?.privateRoomStatus === 'active') {
      document.querySelector('#bid-history-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  placeBid(): void {
    if (!this.listing || this.isPlacingBid) return;

    const canBid = this.isPlatinumBidder && this.isBiddingOpen;

    if (!canBid) {
      Swal.fire({
        icon: 'info',
        title: 'Cannot place bid',
        text: !this.isPlatinumBidder
          ? 'Only invited bidders (by the seller) can place bids. You can watch the room.'
          : this.countdown <= 0
            ? this.translate.instant('privateRoomAuction.expired.bodyConfirming')
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
        this.bidInputError = `Your bid must be at least ${this.formatEur(minBid)} (current bid + increment).`;
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
        this.postHog.track(AnalyticsEvents.PRIVATE_ROOM_BID_PLACED, {
          listing_id: this.listing!._id,
          listing_slug: this.listing!.slug,
          item_category: this.listing!.category,
          amount,
        });
        this.loadListing(); // loadListing calls loadBids internally
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: `Bid of ${this.formatEur(amount)} placed successfully!`,
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

  private formatEur(amount: number): string {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(amount);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

