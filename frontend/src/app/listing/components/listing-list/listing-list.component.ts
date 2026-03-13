import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing, ListingsQueryParams } from '../../../shared/services/listings.service';
import { CATEGORIES, Category } from '../../../shared/config/categories.config';

@Component({
  selector: 'app-listing-list',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent, FooterComponent],
  templateUrl: './listing-list.component.html',
  styleUrls: ['./listing-list.component.scss']
})
export class ListingListComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private listingsService = inject(ListingsService);

  listings: Listing[] = [];
  total = 0;
  loading = true;
  error: string | null = null;

  sortBy: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' = 'deadline';
  selectedCategory = '';
  selectedSubCategory = '';
  searchQuery = '';
  searchInput = ''; // bound to the input field

  readonly categories: Category[] = CATEGORIES;

  get subCategories(): string[] {
    const cat = this.categories.find(c => c.id === this.selectedCategory);
    return cat ? cat.subCategories : [];
  }

  get activeCategoryLabel(): string {
    return this.categories.find(c => c.id === this.selectedCategory)?.name ?? '';
  }

  get pageTitle(): string {
    if (this.searchQuery && this.activeCategoryLabel) {
      return `"${this.searchQuery}" in ${this.activeCategoryLabel}`;
    }
    if (this.searchQuery) return `Results for "${this.searchQuery}"`;
    if (this.activeCategoryLabel && this.selectedSubCategory) {
      return `${this.activeCategoryLabel} — ${this.selectedSubCategory}`;
    }
    if (this.activeCategoryLabel) return this.activeCategoryLabel;
    return 'All Auctions';
  }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.selectedCategory = params['category'] || '';
      this.selectedSubCategory = params['subCategory'] || '';
      this.searchQuery = params['search'] || '';
      this.searchInput = this.searchQuery;
      this.sortBy = params['sort'] || 'deadline';
      this.loadListings();
    });
  }

  loadListings(): void {
    this.loading = true;
    this.error = null;

    const params: ListingsQueryParams = {
      sort: this.sortBy,
      status: 'active',
      limit: 60
    };

    if (this.selectedCategory) params.category = this.selectedCategory;
    if (this.selectedSubCategory) params.subCategory = this.selectedSubCategory;
    if (this.searchQuery) params.search = this.searchQuery;

    this.listingsService.getListings(params).subscribe({
      next: (response) => {
        this.listings = response.listings;
        this.total = response.total;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading listings:', err);
        this.error = 'Failed to load listings. Please try again.';
        this.loading = false;
      }
    });
  }

  private navigate(): void {
    const queryParams: Record<string, string> = {};
    if (this.selectedCategory) queryParams['category'] = this.selectedCategory;
    if (this.selectedSubCategory) queryParams['subCategory'] = this.selectedSubCategory;
    if (this.searchQuery) queryParams['search'] = this.searchQuery;
    if (this.sortBy !== 'deadline') queryParams['sort'] = this.sortBy;
    this.router.navigate([], { queryParams, replaceUrl: true });
  }

  onSearch(): void {
    this.searchQuery = this.searchInput.trim();
    this.navigate();
  }

  onCategoryChange(): void {
    this.selectedSubCategory = '';
    this.navigate();
  }

  onSubCategoryChange(): void {
    this.navigate();
  }

  onSortChange(): void {
    this.navigate();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchInput = '';
    this.navigate();
  }

  clearCategory(): void {
    this.selectedCategory = '';
    this.selectedSubCategory = '';
    this.navigate();
  }

  clearSubCategory(): void {
    this.selectedSubCategory = '';
    this.navigate();
  }

  viewListing(slug: string | undefined): void {
    if (!slug) return;
    this.router.navigate(['/listing', slug]);
  }

  browseCategoriesPage(): void {
    this.router.navigate(['/listing/categories']);
  }

  formatPrice(price: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(price);
  }

  formatTimeRemaining(listing: Listing): string {
    if (!listing.timeRemaining) return 'N/A';
    const { ended, days, hours, minutes } = listing.timeRemaining;
    if (ended) return 'Ended';
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
}
