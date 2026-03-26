import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing, ListingsQueryParams } from '../../../shared/services/listings.service';
import { CATEGORIES, Category } from '../../../shared/config/categories.config';

const PAGE_SIZE = 20;

export const CONDITION_OPTIONS: { key: string; label: string }[] = [
  { key: 'new',       label: 'New' },
  { key: 'like-new',  label: 'Like New' },
  { key: 'very-good', label: 'Very Good' },
  { key: 'good',      label: 'Good' },
  { key: 'fair',      label: 'Fair' },
  { key: 'for-parts', label: 'For Parts' },
];

/** Matches add-listing shippingOption values */
export const SHIPPING_OPTIONS: { key: string; labelKey: string }[] = [
  { key: 'flat-rate', labelKey: 'addListing.shippingFlatRate' },
  { key: 'calculated', labelKey: 'addListing.shippingCalculated' },
  { key: 'local-pickup', labelKey: 'addListing.shippingLocalPickup' },
  { key: 'free', labelKey: 'addListing.shippingFree' },
];

/** Same ISO options as add-listing item country */
export const LOCATION_COUNTRY_OPTIONS: { code: string; labelKey: string }[] = [
  { code: 'US', labelKey: 'addListing.countryUS' },
  { code: 'CA', labelKey: 'addListing.countryCA' },
  { code: 'GB', labelKey: 'addListing.countryGB' },
  { code: 'AU', labelKey: 'addListing.countryAU' },
  { code: 'DE', labelKey: 'addListing.countryDE' },
  { code: 'FR', labelKey: 'addListing.countryFR' },
];

@Component({
  selector: 'app-listing-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './listing-list.component.html',
  styleUrls: ['./listing-list.component.scss']
})
export class ListingListComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private listingsService = inject(ListingsService);
  private translate = inject(TranslateService);

  listings: Listing[] = [];
  total = 0;
  totalPages = 1;
  currentPage = 1;
  loading = true;
  error: string | null = null;
  filtersOpen = false;

  sortBy: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' | 'recent-end' = 'deadline';
  /** Browse live listings or closed (ended) auctions */
  listingStatusFilter: 'active' | 'ended' = 'active';
  selectedCategory = '';
  selectedSubCategory = '';
  searchQuery = '';
  searchInput = '';

  // New filters
  selectedConditions: Set<string> = new Set();
  selectedShipping: Set<string> = new Set();
  /** Filter: item location (partial text match) */
  locationCityFilter = '';
  /** Filter: ISO country code or empty for any */
  locationCountryFilter = '';
  minPrice = '';
  maxPrice = '';

  readonly categories: Category[] = CATEGORIES;
  readonly pageSize = PAGE_SIZE;
  readonly conditionOptions = CONDITION_OPTIONS;
  readonly shippingOptions = SHIPPING_OPTIONS;
  readonly countryFilterOptions = LOCATION_COUNTRY_OPTIONS;

  get subCategories(): string[] {
    const cat = this.categories.find(c => c.id === this.selectedCategory);
    return cat ? cat.subCategories : [];
  }

  get activeCategoryLabel(): string {
    return this.categories.find(c => c.id === this.selectedCategory)?.name ?? '';
  }

  get pageTitle(): string {
    let base: string;
    if (this.searchQuery && this.activeCategoryLabel) base = `"${this.searchQuery}" in ${this.activeCategoryLabel}`;
    else if (this.searchQuery) base = `Results for "${this.searchQuery}"`;
    else if (this.activeCategoryLabel && this.selectedSubCategory) base = `${this.activeCategoryLabel} — ${this.selectedSubCategory}`;
    else if (this.activeCategoryLabel) base = this.activeCategoryLabel;
    else base = this.translate.instant('listingList.allAuctions');
    if (this.listingStatusFilter === 'ended') {
      const closedLabel = this.translate.instant('listingList.closedAuctions');
      return base === this.translate.instant('listingList.allAuctions')
        ? closedLabel
        : `${closedLabel} — ${base}`;
    }
    return base;
  }

  get pageFrom(): number { return this.total === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1; }
  get pageTo(): number { return Math.min(this.currentPage * this.pageSize, this.total); }

  get hasActiveFilters(): boolean {
    return !!(
      this.listingStatusFilter === 'ended' ||
      this.selectedConditions.size ||
      this.selectedShipping.size ||
      this.locationCityFilter.trim() ||
      this.locationCountryFilter ||
      this.minPrice ||
      this.maxPrice
    );
  }

  get activeFilterCount(): number {
    return (
      (this.listingStatusFilter === 'ended' ? 1 : 0) +
      this.selectedConditions.size +
      this.selectedShipping.size +
      (this.locationCityFilter.trim() || this.locationCountryFilter ? 1 : 0) +
      (this.minPrice || this.maxPrice ? 1 : 0)
    );
  }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.selectedCategory = params['category'] || '';
      this.selectedSubCategory = params['subCategory'] || '';
      this.searchQuery = params['search'] || '';
      this.searchInput = this.searchQuery;
      this.listingStatusFilter = params['listingStatus'] === 'ended' ? 'ended' : 'active';
      let sort = (params['sort'] || 'deadline') as 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' | 'recent-end';
      if (this.listingStatusFilter === 'ended' && (sort === 'deadline' || !params['sort'])) {
        sort = 'recent-end';
      }
      if (this.listingStatusFilter === 'active' && sort === 'recent-end') {
        sort = 'deadline';
      }
      this.sortBy = sort;
      this.currentPage = parseInt(params['page'] || '1', 10) || 1;
      this.selectedConditions = new Set((params['condition'] || '').split(',').filter(Boolean));
      this.selectedShipping = new Set((params['shipping'] || '').split(',').filter(Boolean));
      this.locationCityFilter = params['locationCity'] || '';
      this.locationCountryFilter = params['locationCountry'] || '';
      this.minPrice = params['minPrice'] || '';
      this.maxPrice = params['maxPrice'] || '';
      this.loadListings();
    });
  }

  loadListings(): void {
    this.loading = true;
    this.error = null;

    let sort = this.sortBy;
    if (this.listingStatusFilter === 'ended' && sort === 'deadline') {
      sort = 'recent-end';
    }

    const params: ListingsQueryParams = {
      sort,
      status: this.listingStatusFilter === 'ended' ? 'ended' : 'active',
      limit: PAGE_SIZE,
      page: this.currentPage
    };

    if (this.selectedCategory) params.category = this.selectedCategory;
    if (this.selectedSubCategory) params.subCategory = this.selectedSubCategory;
    if (this.searchQuery) params.search = this.searchQuery;
    if (this.selectedConditions.size) params.condition = [...this.selectedConditions].join(',');
    if (this.selectedShipping.size) params.shipping = [...this.selectedShipping].join(',');
    if (this.locationCityFilter.trim()) params.locationCity = this.locationCityFilter.trim();
    if (this.locationCountryFilter) params.locationCountry = this.locationCountryFilter;
    if (this.minPrice) params.minPrice = parseFloat(this.minPrice);
    if (this.maxPrice) params.maxPrice = parseFloat(this.maxPrice);

    this.listingsService.getListings(params).subscribe({
      next: (response) => {
        this.listings = response.listings;
        this.total = response.total;
        this.totalPages = response.totalPages || Math.ceil(response.total / PAGE_SIZE);
        this.loading = false;
      },
      error: () => {
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
    if (this.listingStatusFilter === 'ended') queryParams['listingStatus'] = 'ended';
    const defaultSort =
      this.listingStatusFilter === 'ended' ? 'recent-end' : 'deadline';
    if (this.sortBy !== defaultSort) queryParams['sort'] = this.sortBy;
    if (this.currentPage > 1) queryParams['page'] = String(this.currentPage);
    if (this.selectedConditions.size) queryParams['condition'] = [...this.selectedConditions].join(',');
    if (this.selectedShipping.size) queryParams['shipping'] = [...this.selectedShipping].join(',');
    if (this.locationCityFilter.trim()) queryParams['locationCity'] = this.locationCityFilter.trim();
    if (this.locationCountryFilter) queryParams['locationCountry'] = this.locationCountryFilter;
    if (this.minPrice) queryParams['minPrice'] = this.minPrice;
    if (this.maxPrice) queryParams['maxPrice'] = this.maxPrice;
    this.router.navigate([], { queryParams, replaceUrl: true });
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages || p === this.currentPage) return;
    this.currentPage = p;
    this.navigate();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  get visiblePages(): number[] {
    const pages: number[] = [];
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(this.totalPages, this.currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  onSearch(): void {
    this.searchQuery = this.searchInput.trim();
    this.currentPage = 1;
    this.navigate();
  }

  onCategoryChange(): void {
    this.selectedSubCategory = '';
    this.currentPage = 1;
    this.navigate();
  }

  onSubCategoryChange(): void {
    this.currentPage = 1;
    this.navigate();
  }

  onSortChange(): void {
    this.currentPage = 1;
    this.navigate();
  }

  onListingStatusChange(): void {
    this.currentPage = 1;
    if (this.listingStatusFilter === 'ended' && this.sortBy === 'deadline') {
      this.sortBy = 'recent-end';
    }
    if (this.listingStatusFilter === 'active' && this.sortBy === 'recent-end') {
      this.sortBy = 'deadline';
    }
    this.navigate();
  }

  toggleCondition(key: string): void {
    if (this.selectedConditions.has(key)) {
      this.selectedConditions.delete(key);
    } else {
      this.selectedConditions.add(key);
    }
    this.selectedConditions = new Set(this.selectedConditions);
    this.currentPage = 1;
    this.navigate();
  }

  toggleShipping(key: string): void {
    if (this.selectedShipping.has(key)) {
      this.selectedShipping.delete(key);
    } else {
      this.selectedShipping.add(key);
    }
    this.selectedShipping = new Set(this.selectedShipping);
    this.currentPage = 1;
    this.navigate();
  }

  onLocationFilterChange(): void {
    this.currentPage = 1;
    this.navigate();
  }

  clearLocationFilters(): void {
    this.locationCityFilter = '';
    this.locationCountryFilter = '';
    this.currentPage = 1;
    this.navigate();
  }

  onPriceChange(): void {
    this.currentPage = 1;
    this.navigate();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchInput = '';
    this.currentPage = 1;
    this.navigate();
  }

  clearCategory(): void {
    this.selectedCategory = '';
    this.selectedSubCategory = '';
    this.currentPage = 1;
    this.navigate();
  }

  clearSubCategory(): void {
    this.selectedSubCategory = '';
    this.currentPage = 1;
    this.navigate();
  }

  clearAllFilters(): void {
    this.selectedConditions = new Set();
    this.selectedShipping = new Set();
    this.locationCityFilter = '';
    this.locationCountryFilter = '';
    this.minPrice = '';
    this.maxPrice = '';
    this.listingStatusFilter = 'active';
    if (this.sortBy === 'recent-end') {
      this.sortBy = 'deadline';
    }
    this.currentPage = 1;
    this.navigate();
  }

  clearListingStatusClosed(): void {
    this.listingStatusFilter = 'active';
    if (this.sortBy === 'recent-end') {
      this.sortBy = 'deadline';
    }
    this.currentPage = 1;
    this.navigate();
  }

  conditionLabel(key: string): string {
    return this.conditionOptions.find(o => o.key === key)?.label ?? key;
  }

  shippingLabel(key: string): string {
    const legacy: Record<string, string> = {
      worldwide: 'listingList.shippingLegacyWorldwide',
      regional: 'listingList.shippingLegacyRegional',
    };
    const opt = this.shippingOptions.find(o => o.key === key);
    if (opt) return this.translate.instant(opt.labelKey);
    const leg = legacy[key];
    return leg ? this.translate.instant(leg) : key;
  }

  locationFilterChipLabel(): string {
    const parts: string[] = [];
    const city = this.locationCityFilter.trim();
    if (city) parts.push(city);
    if (this.locationCountryFilter) {
      const opt = this.countryFilterOptions.find(c => c.code === this.locationCountryFilter);
      parts.push(opt ? this.translate.instant(opt.labelKey) : this.locationCountryFilter);
    }
    return parts.join(', ');
  }

  viewListing(slug: string | undefined): void {
    if (!slug) return;
    this.router.navigate(['/listing', slug]);
  }

  browseCategoriesPage(): void {
    this.router.navigate(['/listing/categories']);
  }

  timerClass(listing: Listing): string {
    if (!listing.timeRemaining) return '';
    const { ended, days, hours } = listing.timeRemaining;
    if (ended) return '';
    if (days === 0 && hours < 1) return 'timer-urgent';
    if (days === 0 && hours < 24) return 'timer-soon';
    return 'timer-ok';
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
