import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { CustomerService, CustomerInfo } from '../../../shared/services/customer.service';
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
  reviewRating = 0;
  reviewComment = '';
  reviewSubmitting = false;
  reviewError: string | null = null;

  constructor(
    private authService: AuthService,
    private listingsService: ListingsService,
    private customerService: CustomerService,
    private reviewsService: ReviewsService
  ) {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    this.loadCustomer();
    this.loadMyListings();
    this.loadPendingReviews();
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
    this.reviewRating = 0;
    this.reviewComment = '';
    this.reviewError = null;
    this.showReviewModal = true;
  }

  closeReviewModal(): void {
    this.showReviewModal = false;
    this.reviewTarget = null;
    this.reviewRating = 0;
    this.reviewComment = '';
    this.reviewError = null;
  }

  setRating(r: number): void {
    this.reviewRating = r;
  }

  submitReview(): void {
    if (!this.reviewTarget || this.reviewRating < 1 || this.reviewRating > 5) {
      this.reviewError = 'Please select a rating from 1 to 5.';
      return;
    }
    this.reviewSubmitting = true;
    this.reviewError = null;
    this.reviewsService.createReview({
      listingId: this.reviewTarget.listingId,
      toUserId: this.reviewTarget.otherPartyId,
      role: this.reviewTarget.roleForReview,
      rating: this.reviewRating,
      comment: this.reviewComment.trim() || undefined
    }).subscribe({
      next: () => {
        this.reviewSubmitting = false;
        this.closeReviewModal();
        this.loadPendingReviews();
        this.loadCustomer();
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
