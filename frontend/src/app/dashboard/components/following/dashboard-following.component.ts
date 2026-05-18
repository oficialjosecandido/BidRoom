import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FollowService } from '../../../shared/services/follow.service';
import { CategoryFollowService } from '../../../shared/services/category-follow.service';

interface FollowedSeller {
  _id: string;
  slug?: string | null;
  firstName: string;
  lastName: string;
  muted: boolean;
}

@Component({
  selector: 'app-dashboard-following',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './dashboard-following.component.html',
  styleUrls: ['./dashboard-following.component.scss']
})
export class DashboardFollowingComponent implements OnInit {
  private followService = inject(FollowService);
  private categoryFollowService = inject(CategoryFollowService);

  sellers: FollowedSeller[] = [];
  categories: string[] = [];
  isLoading = true;
  togglingMute: string | null = null;
  unfollowingSeller: string | null = null;
  unfollowingCategory: string | null = null;

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.isLoading = true;
    let sellersLoaded = false;
    let categoriesLoaded = false;

    const done = () => {
      if (sellersLoaded && categoriesLoaded) this.isLoading = false;
    };

    this.followService.getFollowing().subscribe({
      next: (res) => { this.sellers = res.following; sellersLoaded = true; done(); },
      error: () => { sellersLoaded = true; done(); }
    });

    this.categoryFollowService.getFollowedCategories().subscribe({
      next: (res) => { this.categories = res.categories; categoriesLoaded = true; done(); },
      error: () => { categoriesLoaded = true; done(); }
    });
  }

  sellerDisplayName(seller: FollowedSeller): string {
    return `${seller.firstName} ${seller.lastName}`.trim() || 'Seller';
  }

  toggleMute(seller: FollowedSeller): void {
    if (this.togglingMute) return;
    this.togglingMute = seller._id;
    this.followService.setMuted(seller._id, !seller.muted).subscribe({
      next: (res) => {
        seller.muted = res.muted;
        this.togglingMute = null;
      },
      error: () => { this.togglingMute = null; }
    });
  }

  unfollowSeller(seller: FollowedSeller): void {
    if (this.unfollowingSeller) return;
    this.unfollowingSeller = seller._id;
    this.followService.unfollow(seller._id).subscribe({
      next: () => {
        this.sellers = this.sellers.filter(s => s._id !== seller._id);
        this.unfollowingSeller = null;
      },
      error: () => { this.unfollowingSeller = null; }
    });
  }

  unfollowCategory(category: string): void {
    if (this.unfollowingCategory) return;
    this.unfollowingCategory = category;
    this.categoryFollowService.unfollow(category).subscribe({
      next: () => {
        this.categories = this.categories.filter(c => c !== category);
        this.unfollowingCategory = null;
      },
      error: () => { this.unfollowingCategory = null; }
    });
  }

  formatCategoryName(cat: string): string {
    return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
}
