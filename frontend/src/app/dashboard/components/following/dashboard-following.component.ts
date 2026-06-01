import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { FollowService } from '../../../shared/services/follow.service';
import { CategoryFollowService, FollowedCategory } from '../../../shared/services/category-follow.service';
import { BlockService, BlockedUser } from '../../../shared/services/block.service';

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
  private blockService = inject(BlockService);

  sellers: FollowedSeller[] = [];
  categories: FollowedCategory[] = [];
  blockedUsers: BlockedUser[] = [];
  isLoading = true;
  togglingMute: string | null = null;
  togglingMuteCategory: string | null = null;
  unfollowingSeller: string | null = null;
  unfollowingCategory: string | null = null;
  unblockingUser: string | null = null;

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.isLoading = true;
    let sellersLoaded = false;
    let categoriesLoaded = false;
    let blockedLoaded = false;

    const done = () => {
      if (sellersLoaded && categoriesLoaded && blockedLoaded) this.isLoading = false;
    };

    this.followService.getFollowing().subscribe({
      next: (res) => { this.sellers = res.following; sellersLoaded = true; done(); },
      error: () => { sellersLoaded = true; done(); }
    });

    this.categoryFollowService.getFollowedCategories().subscribe({
      next: (res) => { this.categories = res.categories; categoriesLoaded = true; done(); },
      error: () => { categoriesLoaded = true; done(); }
    });

    this.blockService.getBlocked().subscribe({
      next: (res) => { this.blockedUsers = res.blocked; blockedLoaded = true; done(); },
      error: () => { blockedLoaded = true; done(); }
    });
  }

  blockedUserDisplayName(user: BlockedUser): string {
    return `${user.firstName} ${user.lastName}`.trim() || 'User';
  }

  unblockUser(userId: string): void {
    if (this.unblockingUser) return;
    this.unblockingUser = userId;
    this.blockService.unblock(userId).subscribe({
      next: () => {
        this.blockedUsers = this.blockedUsers.filter(u => u._id !== userId);
        this.unblockingUser = null;
      },
      error: () => { this.unblockingUser = null; }
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

  toggleMuteCategory(cat: FollowedCategory): void {
    if (this.togglingMuteCategory) return;
    this.togglingMuteCategory = cat.category;
    this.categoryFollowService.setMuted(cat.category, !cat.muted).subscribe({
      next: (res) => {
        cat.muted = res.muted ?? !cat.muted;
        this.togglingMuteCategory = null;
      },
      error: () => { this.togglingMuteCategory = null; }
    });
  }

  unfollowCategory(category: string): void {
    if (this.unfollowingCategory) return;
    this.unfollowingCategory = category;
    this.categoryFollowService.unfollow(category).subscribe({
      next: () => {
        this.categories = this.categories.filter(c => c.category !== category);
        this.unfollowingCategory = null;
      },
      error: () => { this.unfollowingCategory = null; }
    });
  }

  formatCategoryName(cat: string): string {
    return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
}
