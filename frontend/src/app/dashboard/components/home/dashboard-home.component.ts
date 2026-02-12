import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { CustomerService, CustomerInfo } from '../../../shared/services/customer.service';
import { PaymentsService, TopupRecord } from '../../../shared/services/payments.service';
import { ReviewsService, PendingReview } from '../../../shared/services/reviews.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './dashboard-home.component.html',
  styleUrls: ['./dashboard-home.component.scss']
})
export class DashboardHomeComponent implements OnInit {
  private authService = inject(AuthService);
  private listingsService = inject(ListingsService);
  private customerService = inject(CustomerService);
  private paymentsService = inject(PaymentsService);
  private reviewsService = inject(ReviewsService);
  private router = inject(Router);

  currentUser$: Observable<AppUser | null>;
  customer: CustomerInfo | null = null;
  activeListings: Listing[] = [];
  endedListings: Listing[] = [];
  pendingReviews: PendingReview[] = [];
  isLoading = true;
  error: string | null = null;

  balance = 0;
  reviewCount = 0;
  buyerScore: number | null = null;
  sellerScore: number | null = null;
  buyerReviewCount = 0;
  sellerReviewCount = 0;

  showReviewModal = false;
  reviewTarget: PendingReview | null = null;
  reviewScore = 0;
  reviewDescription = '';
  reviewSubmitting = false;
  reviewError: string | null = null;

  showBalanceModal = false;
  balanceModalAmount: number | null = null;
  balanceModalIsCustom = false;
  balanceModalCustomInput = '';
  balanceModalSubmitting = false;
  balanceModalError: string | null = null;

  readonly minBalanceAmount = 5;
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

  constructor() {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    this.loadCustomer();
    this.loadMyListings();
    this.loadPendingReviews();
    this.loadTopups();
    this.checkPaymentReturn();
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

  openBalanceModal(): void {
    this.showBalanceModal = true;
    this.balanceModalAmount = null;
    this.balanceModalIsCustom = false;
    this.balanceModalCustomInput = '';
    this.balanceModalError = null;
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
        ? `Please enter at least $${this.minBalanceAmount}.`
        : 'Please select an amount or enter a custom value (min $5).';
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
        this.balanceModalError = err?.error?.message || 'Failed to start checkout. Try again.';
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
    this.reviewError = null;
    this.showReviewModal = true;
  }

  closeReviewModal(): void {
    this.showReviewModal = false;
    this.reviewTarget = null;
    this.reviewScore = 0;
    this.reviewDescription = '';
    this.reviewError = null;
  }

  setRating(r: number): void {
    this.reviewScore = r;
  }

  submitReview(): void {
    if (!this.reviewTarget || this.reviewScore < 1 || this.reviewScore > 10) {
      this.reviewError = 'Please select a score from 1 to 10.';
      return;
    }
    this.reviewSubmitting = true;
    this.reviewError = null;
    this.reviewsService.createReview({
      listingId: this.reviewTarget.listingId,
      toUserId: this.reviewTarget.otherPartyId,
      role: this.reviewTarget.roleForReview,
      score: this.reviewScore,
      description: this.reviewDescription.trim() || undefined
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
        this.reviewError = err?.error?.message || 'Failed to submit review.';
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
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load your listings';
        this.isLoading = false;
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

  formatPrice(value: number): string {
    return '$' + value.toFixed(2);
  }
}
