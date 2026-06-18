import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import Swal from 'sweetalert2';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { CustomerService, CustomerInfo, DsaWarningInfo } from '../../../shared/services/customer.service';
import { PaymentsService, TopupRecord } from '../../../shared/services/payments.service';
import { ReviewsService, PendingReview, ReviewTag } from '../../../shared/services/reviews.service';
import { FeatureFlagsService } from '../../../shared/services/feature-flags.service';
import { SocketService } from '../../../shared/services/socket.service';
import { TransactionsService } from '../../../shared/services/transactions.service';
import { BuyerPaymentService } from '../../../shared/services/buyer-payment.service';
import { DashboardAnalyticsComponent } from '../dashboard-analytics/dashboard-analytics.component';
import { Observable, Subscription } from 'rxjs';

interface BidderListing extends Listing {
  type?: string;
  bets?: Array<{ _id: string; amount: number; createdAt: string; type: string; status: string }>;
  notifyWhenOutbid?: boolean;
  isWinner?: boolean;
  myHighestBid?: number | null;
}

interface HomeStatCard {
  key: string;
  label: string;
  value: string;
  sub: string;
  valueTone: '' | 'gold' | 'green' | 'amber';
  subUp?: boolean;
}

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, TranslateModule, DashboardAnalyticsComponent],
  templateUrl: './dashboard-home.component.html',
  styleUrls: ['./dashboard-home.component.scss']
})
export class DashboardHomeComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private listingsService = inject(ListingsService);
  private customerService = inject(CustomerService);
  private paymentsService = inject(PaymentsService);
  private reviewsService = inject(ReviewsService);
  featureFlags = inject(FeatureFlagsService);
  private socketService = inject(SocketService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  private transactionsService = inject(TransactionsService);
  private buyerPaymentService = inject(BuyerPaymentService);

  private socketSubscriptions: Subscription[] = [];
  private joinedListingIds: string[] = [];
  private destroyed = false;

  currentUser$: Observable<AppUser | null>;
  customer: CustomerInfo | null = null;
  activeListings: Listing[] = [];
  endedListings: Listing[] = [];
  bidderListings: BidderListing[] = [];
  pendingReviews: PendingReview[] = [];
  pendingBuyerTransactions = 0;
  pendingSellerTransactions = 0;
  completedBuyerTransactions = 0;
  completedSellerTransactions = 0;
  isLoading = true;
  error: string | null = null;

  balance = 0;
  reviewCount = 0;
  buyerScore: number | null = null;
  sellerScore: number | null = null;
  buyerReviewCount = 0;
  sellerReviewCount = 0;
  hasPaymentMethod = false;
  paymentMethodsLoading = true;

  showReviewModal = false;
  reviewTarget: PendingReview | null = null;
  reviewScore = 0;
  reviewDescription = '';
  reviewTags: ReviewTag[] = [];
  reviewSubmitting = false;
  reviewError: string | null = null;

  readonly TAGS_AS_SELLER: ReviewTag[] = [
    'fast_shipping', 'item_as_described', 'great_packaging', 'good_communication',
    'slow_shipping', 'not_as_described', 'poor_communication'
  ];
  readonly TAGS_AS_BUYER: ReviewTag[] = [
    'fast_payment', 'smooth_transaction', 'trustworthy', 'good_communication',
    'slow_payment', 'poor_communication'
  ];

  get availableTags(): ReviewTag[] {
    return this.reviewTarget?.roleForReview === 'as_buyer' ? this.TAGS_AS_BUYER : this.TAGS_AS_SELLER;
  }

  showBalanceModal = false;
  balanceModalAmount: number | null = null;
  balanceModalIsCustom = false;
  balanceModalCustomInput = '';
  balanceModalSubmitting = false;
  balanceModalError: string | null = null;

  readonly minBalanceAmount = 5;
  /** Review averages use the same 1–5 star scale as transaction reviews. */
  readonly reviewScoreMax = 5;

  reviewScorePercent(score: number): number {
    return Math.min(100, Math.max(0, (score / this.reviewScoreMax) * 100));
  }
  topups: TopupRecord[] = [];

  readonly membershipTiers = [
    { name: 'Bronze', amount: 10 },
    { name: 'Silver', amount: 25 },
    { name: 'Gold', amount: 100 },
    { name: 'Platinum', amount: 1000 }
  ] as const;

  /** Current membership tier based on balance (highest tier whose threshold is <= balance). */
  get currentMembershipTier(): { name: string; amount: number } | null {
    const tiers = [...this.membershipTiers].sort((a, b) => b.amount - a.amount);
    const t = tiers.find(tier => this.balance >= tier.amount);
    return t ? { name: t.name, amount: t.amount } : null;
  }

  /** Next tier to unlock (lowest tier above current balance), if any. */
  get nextTierToUnlock(): { name: string; amount: number } | null {
    const sorted = [...this.membershipTiers].sort((a, b) => a.amount - b.amount);
    return sorted.find(t => t.amount > this.balance) ?? null;
  }

  /** Progress toward next tier (0–100). */
  getMembershipProgressPercent(): number {
    const next = this.nextTierToUnlock;
    if (!next || next.amount <= 0) return 100;
    return Math.min(100, Math.round((this.balance / next.amount) * 100));
  }

  constructor() {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    this.loadCustomer();
    this.loadPaymentMethods();
    this.loadMyListings();
    this.loadBidderListings();
    this.loadPendingTransactionCounts();
    this.loadPendingReviews();
    this.loadTopups();
    this.checkPaymentReturn();
  }

  loadBidderListings(): void {
    this.listingsService.getBidderBets().subscribe({
      next: (res) => {
        this.bidderListings = (res.listings || []) as BidderListing[];
      },
      error: () => {
        this.bidderListings = [];
      }
    });
  }

  loadPendingTransactionCounts(): void {
    this.transactionsService.getMyTransactions().subscribe({
      next: ({ transactions }) => {
        const DONE = new Set(['completed', 'cancelled']);
        let pendingBuyer = 0;
        let pendingSeller = 0;
        let completedBuyer = 0;
        let completedSeller = 0;
        for (const t of transactions) {
          const status = t.transactionStatus ?? t.status ?? '';
          if (status === 'completed') {
            if (t.role === 'buyer') completedBuyer++;
            else if (t.role === 'seller') completedSeller++;
            continue;
          }
          if (DONE.has(status)) continue;
          if (t.role === 'buyer') pendingBuyer++;
          else if (t.role === 'seller') pendingSeller++;
        }
        this.pendingBuyerTransactions = pendingBuyer;
        this.pendingSellerTransactions = pendingSeller;
        this.completedBuyerTransactions = completedBuyer;
        this.completedSellerTransactions = completedSeller;
      }
    });
  }

  get activeBidderListings(): BidderListing[] {
    return this.bidderListings.filter((l) => l.status === 'active');
  }

  get pendingOffersCount(): number {
    return this.bidderListings.filter((l) => {
      if (l.auctionFormat !== 'best-offer' || l.status !== 'active') return false;
      return (l.bets || []).some((b) => b.status === 'pending');
    }).length;
  }

  /** Has listed at least one item (active or ended). */
  get isSellerUser(): boolean {
    return this.activeListings.length + this.endedListings.length > 0;
  }

  /** Has completed at least one purchase as buyer. */
  get isBuyerUser(): boolean {
    return this.completedBuyerTransactions > 0;
  }

  get isEmailVerified(): boolean {
    return this.customer?.user?.emailVerified === true;
  }

  get statCards(): HomeStatCard[] {
    const cards: HomeStatCard[] = [];

    const bids = this.activeBidderListings.length;
    if (bids > 0) {
      cards.push({
        key: 'activeBids',
        label: this.translate.instant('dashboard.home.statActiveBids'),
        value: String(bids),
        sub: this.translate.instant('dashboard.home.statAcrossAuctions', { count: bids }),
        valueTone: ''
      });
    }

    const offers = this.pendingOffersCount;
    if (offers > 0) {
      cards.push({
        key: 'pendingOffers',
        label: this.translate.instant('dashboard.home.statPendingOffers'),
        value: String(offers),
        sub: this.translate.instant('dashboard.home.statAwaitingSeller'),
        valueTone: ''
      });
    }

    if (this.pendingBuyerTransactions > 0) {
      cards.push({
        key: 'pendingTxBuyer',
        label: this.translate.instant('dashboard.home.statPendingTx'),
        value: String(this.pendingBuyerTransactions),
        sub: this.translate.instant('dashboard.home.statActionNeeded'),
        valueTone: 'amber'
      });
    }

    const live = this.activeListings.length;
    if (live > 0) {
      cards.push({
        key: 'activeListings',
        label: this.translate.instant('dashboard.home.statActiveListings'),
        value: String(live),
        sub: this.translate.instant('dashboard.home.live'),
        valueTone: 'green'
      });
    }

    if (this.pendingSellerTransactions > 0) {
      cards.push({
        key: 'pendingTxSeller',
        label: this.translate.instant('dashboard.home.statPendingTx'),
        value: String(this.pendingSellerTransactions),
        sub: this.translate.instant('dashboard.home.statActionNeeded'),
        valueTone: 'amber'
      });
    }

    return cards;
  }

  get topRowGridColumns(): string {
    const n = this.statCards.length;
    if (n <= 1) return '1fr';
    if (n === 2) return 'repeat(2, 1fr)';
    if (n === 3) return 'repeat(3, 1fr)';
    return 'repeat(auto-fit, minmax(220px, 1fr))';
  }

  isListingWinning(listing: BidderListing): boolean {
    return listing.isWinner === true;
  }

  isListingOutbid(listing: BidderListing): boolean {
    return listing.status === 'active' && !listing.isWinner;
  }

  getBidStatusKey(listing: BidderListing): string {
    if (listing.isWinner) return 'dashboard.home.statusWinning';
    if (listing.status === 'active') return 'dashboard.home.statusOutbid';
    return 'dashboard.home.statusEnded';
  }

  getBidStatusClass(listing: BidderListing): string {
    if (listing.isWinner) return 'status-live';
    if (listing.status === 'active') return 'status-pending';
    return 'status-ended';
  }

  getTimeRemaining(endDate: string): string {
    const ms = new Date(endDate).getTime() - Date.now();
    if (ms <= 0) return this.translate.instant('dashboard.home.ended');
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      return this.translate.instant('dashboard.home.endsInDays', { days: d });
    }
    return this.translate.instant('dashboard.home.endsInHours', { hours: h, minutes: m });
  }

  getFormatLabel(listing: Listing): string {
    return listing.auctionFormat === 'best-offer'
      ? this.translate.instant('dashboard.home.formatBestOffer')
      : this.translate.instant('dashboard.home.formatAuction');
  }

  getListingThumb(listing: Listing): string | null {
    return listing.images?.[0] || null;
  }

  getListingEmoji(listing: Listing): string {
    const c = (listing.category || '').toLowerCase();
    if (c.includes('watch') || c.includes('relóg')) return '⌚';
    if (c.includes('art') || c.includes('arte')) return '🎨';
    if (c.includes('jewel') || c.includes('jóia')) return '💎';
    if (c.includes('photo') || c.includes('câmara')) return '📷';
    if (c.includes('car') || c.includes('auto')) return '🏎';
    return '📦';
  }

  loadTopups(): void {
    this.paymentsService.getTopups().subscribe({
      next: (res) => {
        this.topups = res.topups || [];
      },
      error: () => {
        this.topups = [];
      }
    });
  }

  checkPaymentReturn(): void {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sessionId = params.get('session_id');
    if (payment === 'success') {
      const done = () => {
        this.loadCustomer();
        this.loadPaymentMethods();
        this.loadTopups();
        this.router.navigate(['/dashboard/home'], { replaceUrl: true }).then(() => {
          Swal.fire({
            icon: 'success',
            title: 'Payment successful',
            text: 'Your balance has been updated. You can use it for auctions and offers.',
            confirmButtonColor: '#7A4F84'
          });
        });
      };
      if (sessionId) {
        this.paymentsService.confirmSession(sessionId).subscribe({
          next: () => done(),
          error: () => done()
        });
      } else {
        done();
      }
    }
  }

  openBalanceModal(preselectedAmount?: number): void {
    this.showBalanceModal = true;
    this.balanceModalAmount = preselectedAmount ?? null;
    this.balanceModalIsCustom = preselectedAmount == null;
    this.balanceModalCustomInput = preselectedAmount != null ? '' : '';
    this.balanceModalError = null;
  }

  selectTierAndOpenModal(amount: number): void {
    this.openBalanceModal(amount);
  }

  closeBalanceModal(): void {
    this.showBalanceModal = false;
    this.balanceModalAmount = null;
    this.balanceModalIsCustom = false;
    this.balanceModalCustomInput = '';
    this.balanceModalError = null;
  }

  selectBalanceTier(amount: number): void {
    this.balanceModalAmount = amount;
    this.balanceModalIsCustom = false;
    this.balanceModalCustomInput = '';
    this.balanceModalError = null;
  }

  selectBalanceCustom(): void {
    this.balanceModalIsCustom = true;
    this.balanceModalCustomInput = this.balanceModalCustomInput || String(this.minBalanceAmount);
    this.updateBalanceCustomAmount();
    this.balanceModalError = null;
  }

  onBalanceCustomInputChange(): void {
    this.updateBalanceCustomAmount();
    this.balanceModalError = null;
  }

  private updateBalanceCustomAmount(): void {
    const parsed = parseFloat(this.balanceModalCustomInput);
    this.balanceModalAmount = !Number.isNaN(parsed) && parsed >= this.minBalanceAmount ? parsed : null;
  }

  getCheckoutAmount(): number | null {
    if (this.balanceModalIsCustom) {
      const parsed = parseFloat(this.balanceModalCustomInput);
      return !Number.isNaN(parsed) && parsed >= this.minBalanceAmount ? parsed : null;
    }
    return this.balanceModalAmount;
  }

  submitBalanceCheckout(): void {
    const amount = this.getCheckoutAmount();
    if (amount == null) {
      this.balanceModalError = this.balanceModalIsCustom
        ? `Please enter at least €${this.minBalanceAmount}.`
        : 'Please select an amount or enter a custom value (min €5).';
      return;
    }
    this.balanceModalSubmitting = true;
    this.balanceModalError = null;
    this.paymentsService.createCheckoutSession(amount).subscribe({
      next: (res) => {
        this.balanceModalSubmitting = false;
        if (res?.url) {
          window.location.href = res.url;
        } else {
          this.balanceModalError = 'No checkout URL received.';
        }
      },
      error: (err) => {
        this.balanceModalSubmitting = false;
        this.balanceModalError = err?.error?.message || this.translate.instant('dashboard.home.checkoutError');
      }
    });
  }

  loadPendingReviews(): void {
    this.reviewsService.getPending().subscribe({
      next: (res) => {
        this.pendingReviews = res.pending || [];
      }
    });
  }

  openReviewModal(item: PendingReview): void {
    this.reviewTarget = item;
    this.reviewScore = 0;
    this.reviewDescription = '';
    this.reviewTags = [];
    this.reviewError = null;
    this.showReviewModal = true;
  }

  closeReviewModal(): void {
    this.showReviewModal = false;
    this.reviewTarget = null;
    this.reviewScore = 0;
    this.reviewDescription = '';
    this.reviewTags = [];
    this.reviewError = null;
  }

  toggleReviewTag(tag: ReviewTag): void {
    const idx = this.reviewTags.indexOf(tag);
    if (idx >= 0) {
      this.reviewTags.splice(idx, 1);
    } else if (this.reviewTags.length < 5) {
      this.reviewTags.push(tag);
    }
  }

  isTagSelected(tag: ReviewTag): boolean {
    return this.reviewTags.includes(tag);
  }

  setRating(r: number): void {
    this.reviewScore = r;
  }

  getScoreEmoji(score: number): string {
    if (score <= 1) return '😞';
    if (score <= 2) return '😐';
    if (score <= 3) return '🙂';
    if (score <= 4) return '😊';
    return '🎉';
  }

  getScoreLabel(score: number): string {
    if (score <= 1) return 'Poor';
    if (score <= 2) return 'Fair';
    if (score <= 3) return 'Good';
    if (score <= 4) return 'Great';
    return 'Excellent!';
  }

  /** Path to buyer or seller profile (which has transactions tab) based on user's role in the transaction */
  getTransactionLink(item: { myRole: 'seller' | 'buyer' }): string[] {
    return ['/dashboard', item.myRole === 'buyer' ? 'buyer' : 'seller'];
  }

  submitReview(): void {
    if (!this.reviewTarget || this.reviewScore < 1 || this.reviewScore > 5) {
      this.reviewError = 'Please select a score from 1 to 5.';
      return;
    }
    this.reviewSubmitting = true;
    this.reviewError = null;
    this.reviewsService.createReview({
      listingId: this.reviewTarget.listingId,
      toUserId: this.reviewTarget.otherPartyId,
      role: this.reviewTarget.roleForReview,
      score: this.reviewScore,
      description: this.reviewDescription.trim() || undefined,
      tags: this.reviewTags.length > 0 ? [...this.reviewTags] : undefined
    }).subscribe({
      next: () => {
        this.reviewSubmitting = false;
        this.closeReviewModal();
        this.loadPendingReviews();
        this.loadCustomer();
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: 'Review submitted',
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true
        });
      },
      error: (err) => {
        this.reviewSubmitting = false;
        this.reviewError = err?.error?.message || this.translate.instant('dashboard.home.reviewError');
      }
    });
  }

  loadPaymentMethods(): void {
    this.paymentMethodsLoading = true;
    this.buyerPaymentService.getPaymentMethods().subscribe({
      next: (res) => {
        this.hasPaymentMethod = res.saved && (res.methods?.length ?? 0) > 0;
        this.paymentMethodsLoading = false;
      },
      error: () => {
        this.hasPaymentMethod = false;
        this.paymentMethodsLoading = false;
      }
    });
  }

  loadCustomer(): void {
    this.customerService.getCustomer().subscribe({
      next: (info) => {
        this.customer = info;
        this.balance = info.balance ?? 0;
        this.reviewCount = info.reviewCount ?? 0;
        this.buyerScore = info.buyerScore ?? null;
        this.sellerScore = info.sellerScore ?? null;
        this.buyerReviewCount = info.buyerReviewCount ?? 0;
        this.sellerReviewCount = info.sellerReviewCount ?? 0;
      },
      error: () => {
        this.balance = 0;
        this.reviewCount = 0;
        this.buyerScore = null;
        this.sellerScore = null;
        this.buyerReviewCount = 0;
        this.sellerReviewCount = 0;
      }
    });
  }

  loadMyListings(): void {
    this.isLoading = true;
    this.error = null;

    this.listingsService.getMyListings().subscribe({
      next: (response) => {
        const all = response.listings || [];
        const now = new Date();
        this.activeListings = all.filter(
          (l) => l.status === 'active' && new Date(l.endDate) > now
        );
        this.endedListings = all.filter(
          (l) => l.status === 'ended' || l.status === 'cancelled' || (l.status === 'active' && new Date(l.endDate) <= now)
        );
        this.isLoading = false;
        this.setupRealTimeUpdates(this.activeListings);
      },
      error: (err) => {
        this.error = err?.message || this.translate.instant('dashboard.home.errorLoading');
        this.isLoading = false;
      }
    });
  }

  private setupRealTimeUpdates(activeListings: Listing[]): void {
    if (this.destroyed) return;
    // Clean up any previous subscriptions and rooms
    this.cleanupRealTime();

    const ids = activeListings.map(l => l._id).filter(Boolean) as string[];
    if (!ids.length) return;

    this.joinedListingIds = ids;
    this.socketService.connect();
    this.socketService.joinListings(ids);

    const newBidSub = this.socketService.onNewBid().subscribe((event) => {
      const listing = this.activeListings.find(l => l._id === event.listingId);
      if (listing && event.bidCount !== undefined) {
        listing.bidCount = event.bidCount;
        if (event.currentPrice !== undefined) listing.currentPrice = event.currentPrice;
      }
    });
    this.socketSubscriptions.push(newBidSub);

    const updateSub = this.socketService.onListingUpdate().subscribe((event) => {
      const listing = this.activeListings.find(l => l._id === event.listingId);
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

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cleanupRealTime();
  }

  /** True when the user hasn't completed payout setup.
   *  Show to anyone without a connected account — buyers who become sellers need it too.
   *  Can be dismissed for the session via the banner's close button. */
  payoutBannerDismissed = false;

  get showPayoutSetupBanner(): boolean {
    if (this.payoutBannerDismissed) return false;
    if (this.isLoading) return false;
    return !this.customer?.stripeConnectOnboarded;
  }

  // ─── DSA Warning Banner ──────────────────────────────────────────────────
  dsaWarningDismissed = false;
  dsaWarningResponding = false;

  get dsaWarning(): DsaWarningInfo | null {
    return this.customer?.dsaWarning ?? null;
  }

  get showDsaWarningBanner(): boolean {
    if (this.dsaWarningDismissed || this.isLoading) return false;
    const w = this.dsaWarning;
    if (!w?.warningIssuedAt) return false;
    return !w.acknowledgedAt;
  }

  respondDsaWarning(response: 'remain_private' | 'switch_professional'): void {
    if (this.dsaWarningResponding) return;
    this.dsaWarningResponding = true;
    this.customerService.respondToDsaWarning(response).subscribe({
      next: () => {
        this.dsaWarningResponding = false;
        this.dsaWarningDismissed = true;
        if (response === 'switch_professional') {
          this.router.navigate(['/dashboard/settings']);
        }
      },
      error: () => {
        this.dsaWarningResponding = false;
        this.dsaWarningDismissed = true;
      }
    });
  }

  dismissDsaWarning(): void {
    this.dsaWarningDismissed = true;
  }

  dismissPayoutBanner(): void {
    this.payoutBannerDismissed = true;
  }

  getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return this.translate.instant('dashboard.home.greeting.morning');
    if (h < 18) return this.translate.instant('dashboard.home.greeting.afternoon');
    return this.translate.instant('dashboard.home.greeting.evening');
  }

  get firstName(): string {
    if (this.customer?.user?.firstName) return this.customer.user.firstName;
    return '';
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

  formatPrice(value: number): string {
    return `€ ${value.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
}
