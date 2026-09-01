import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { CATEGORIES, Category } from '../../../shared/config/categories.config';
import { CategoryFollowService } from '../../../shared/services/category-follow.service';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss'
})
export class CategoriesComponent implements OnInit {
  private router = inject(Router);
  private categoryFollowService = inject(CategoryFollowService);
  private authService = inject(AuthService);

  categories: Category[] = CATEGORIES;

  followedCategories = new Set<string>();
  followTogglingCategory: string | null = null;
  isLoggedIn = false;

  private readonly categoryMetaKeys: Record<string, { title: string; desc: string }> = {
    electronics: {
      title: 'home.categories.electronics.title',
      desc: 'home.categories.electronics.desc'
    },
    'home-garden': {
      title: 'home.categories.homeGarden.title',
      desc: 'home.categories.homeGarden.desc'
    },
    art: {
      title: 'home.categories.art.title',
      desc: 'home.categories.art.desc'
    },
    collectibles: {
      title: 'home.categories.collectibles.title',
      desc: 'home.categories.collectibles.desc'
    },
    jewelry: {
      title: 'home.categories.jewelry.title',
      desc: 'home.categories.jewelry.desc'
    },
    'real-estate': {
      title: 'home.categories.realEstate.title',
      desc: 'home.categories.realEstate.desc'
    },
    vehicles: {
      title: 'home.categories.vehicles.title',
      desc: 'home.categories.vehicles.desc'
    }
  };

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.isLoggedIn = !!user;
      if (user) this.loadFollowedCategories();
    });
  }

  categoryTitleKey(catId: string): string {
    return this.categoryMetaKeys[catId]?.title ?? `addListing.categories.${catId}`;
  }

  categoryDescKey(catId: string): string {
    return this.categoryMetaKeys[catId]?.desc ?? '';
  }

  subCategoryLabelKey(sub: string): string {
    return `addListing.subcategories.${sub}`;
  }

  loadFollowedCategories(): void {
    this.categoryFollowService.getFollowedCategories().subscribe({
      next: (res) => { this.followedCategories = new Set(res.categories.map(c => c.category)); },
      error: () => {}
    });
  }

  toggleFollowCategory(event: Event, categoryId: string): void {
    event.stopPropagation();
    if (!this.isLoggedIn) {
      this.router.navigate(['/auth/login']);
      return;
    }
    if (this.followTogglingCategory) return;
    this.followTogglingCategory = categoryId;
    const isFollowing = this.followedCategories.has(categoryId);
    const action$ = isFollowing
      ? this.categoryFollowService.unfollow(categoryId)
      : this.categoryFollowService.follow(categoryId);

    action$.subscribe({
      next: (res) => {
        if (res.following) {
          this.followedCategories.add(categoryId);
        } else {
          this.followedCategories.delete(categoryId);
        }
        this.followedCategories = new Set(this.followedCategories);
        this.followTogglingCategory = null;
      },
      error: () => { this.followTogglingCategory = null; }
    });
  }

  browseCategory(categoryId: string): void {
    this.router.navigate(['/listing/list'], { queryParams: { category: categoryId } });
  }

  browseSubCategory(categoryId: string, subCategory: string): void {
    this.router.navigate(['/listing/list'], { queryParams: { category: categoryId, subCategory } });
  }

  browseAll(): void {
    this.router.navigate(['/listing/list']);
  }
}
