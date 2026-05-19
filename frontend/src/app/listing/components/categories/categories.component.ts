import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { CATEGORIES, Category } from '../../../shared/config/categories.config';
import { CONDITION_OPTIONS, SHIPPING_OPTIONS, LOCATION_COUNTRY_OPTIONS } from '../listing-list/listing-list.component';
import { CategoryFollowService } from '../../../shared/services/category-follow.service';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss'
})
export class CategoriesComponent implements OnInit {
  private router = inject(Router);
  private categoryFollowService = inject(CategoryFollowService);
  private authService = inject(AuthService);

  categories: Category[] = CATEGORIES;

  readonly conditionOptions = CONDITION_OPTIONS;
  readonly shippingOptions = SHIPPING_OPTIONS;
  readonly countryFilterOptions = LOCATION_COUNTRY_OPTIONS;

  selectedConditions: Set<string> = new Set();
  selectedShipping: Set<string> = new Set();
  locationCityFilter = '';
  locationCountryFilter = '';
  minPrice = '';
  maxPrice = '';

  followedCategories = new Set<string>();
  followTogglingCategory: string | null = null;
  isLoggedIn = false;

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.isLoggedIn = !!user;
      if (user) this.loadFollowedCategories();
    });
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
      this.router.navigate(['/login']);
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

  get hasActiveFilters(): boolean {
    return !!(
      this.selectedConditions.size ||
      this.selectedShipping.size ||
      this.locationCityFilter.trim() ||
      this.locationCountryFilter ||
      this.minPrice ||
      this.maxPrice
    );
  }

  private buildFilterParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.selectedConditions.size) params['condition'] = [...this.selectedConditions].join(',');
    if (this.selectedShipping.size) params['shipping'] = [...this.selectedShipping].join(',');
    if (this.locationCityFilter.trim()) params['locationCity'] = this.locationCityFilter.trim();
    if (this.locationCountryFilter) params['locationCountry'] = this.locationCountryFilter;
    if (this.minPrice) params['minPrice'] = this.minPrice;
    if (this.maxPrice) params['maxPrice'] = this.maxPrice;
    return params;
  }

  toggleCondition(key: string): void {
    if (this.selectedConditions.has(key)) {
      this.selectedConditions.delete(key);
    } else {
      this.selectedConditions.add(key);
    }
    this.selectedConditions = new Set(this.selectedConditions);
  }

  toggleShipping(key: string): void {
    if (this.selectedShipping.has(key)) {
      this.selectedShipping.delete(key);
    } else {
      this.selectedShipping.add(key);
    }
    this.selectedShipping = new Set(this.selectedShipping);
  }

  clearFilters(): void {
    this.selectedConditions = new Set();
    this.selectedShipping = new Set();
    this.locationCityFilter = '';
    this.locationCountryFilter = '';
    this.minPrice = '';
    this.maxPrice = '';
  }

  browseCategory(categoryId: string): void {
    this.router.navigate(['/listing/list'], {
      queryParams: { category: categoryId, ...this.buildFilterParams() }
    });
  }

  browseSubCategory(categoryId: string, subCategory: string): void {
    this.router.navigate(['/listing/list'], {
      queryParams: { category: categoryId, subCategory, ...this.buildFilterParams() }
    });
  }

  browseAll(): void {
    this.router.navigate(['/listing/list'], { queryParams: this.buildFilterParams() });
  }
}
