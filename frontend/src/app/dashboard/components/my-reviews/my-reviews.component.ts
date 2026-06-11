import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReviewsService, MyReview } from '../../../shared/services/reviews.service';

@Component({
  selector: 'app-my-reviews',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './my-reviews.component.html',
  styleUrls: ['./my-reviews.component.scss']
})
export class MyReviewsComponent implements OnInit {
  private reviewsService = inject(ReviewsService);
  private translate = inject(TranslateService);

  activeTab: 'received' | 'written' = 'received';
  written: MyReview[] = [];
  received: MyReview[] = [];
  loading = true;
  error: string | null = null;

  ngOnInit(): void {
    this.reviewsService.getMine().subscribe({
      next: (res) => {
        this.written  = res.written;
        this.received = res.received;
        this.loading  = false;
      },
      error: () => {
        this.error   = this.translate.instant('dashboard.myReviews.loadError');
        this.loading = false;
      }
    });
  }

  get activeList(): MyReview[] {
    return this.activeTab === 'received' ? this.received : this.written;
  }

  stars(score: number): number[] {
    return Array.from({ length: 5 }, (_, i) => i + 1);
  }

  otherPartyName(review: MyReview): string {
    const party = this.activeTab === 'received' ? review.reviewer : review.reviewee;
    if (!party) return '—';
    return `${party.firstName} ${party.lastName}`.trim();
  }

  otherPartySlug(review: MyReview): string | null {
    const party = this.activeTab === 'received' ? review.reviewer : review.reviewee;
    return party?.slug ?? null;
  }

  roleLabel(review: MyReview): string {
    // role describes how the reviewee was reviewed
    if (this.activeTab === 'received') {
      return review.role === 'as_buyer'
        ? this.translate.instant('dashboard.myReviews.asBuyer')
        : this.translate.instant('dashboard.myReviews.asSeller');
    } else {
      return review.role === 'as_buyer'
        ? this.translate.instant('dashboard.myReviews.youReviewedBuyer')
        : this.translate.instant('dashboard.myReviews.youReviewedSeller');
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  listingImage(review: MyReview): string {
    return review.listing?.images?.[0] ?? '';
  }
}
