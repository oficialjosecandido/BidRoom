import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing, ListingsQueryParams } from '../../../shared/services/listings.service';
import { CATEGORIES, Category } from '../../../shared/config/categories.config';

const PAGE_SIZE = 20;

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

  listings: Listing[] = [];
  total = 0;
  totalPages = 1;
  currentPage = 1;
  loading = true;
  error: string | null = null;

  sortBy: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' = 'deadline';
  selectedCategory = '';
  selectedSubCategory = '';
  searchQuery = '';
  searchInput = '';

  readonly categories: Category[] = CATEGORIES;
  readonly pageSize = PAGE_SIZE;

  get subCategories(): string[] {
    const cat = this.categories.find(c => c.id === this.selectedCategory);
    return cat ? cat.subCategories : [];
  }

  get activeCategoryLabel(): string {
    return this.categories.find(c => c.id === this.selectedCategory)?.name ?? '';
  }

  get pageTitle(): string {
    if (this.searchQuery && this.activeCategoryLabel) return `"${this.searchQuery}" in ${this.activeCategoryLabel}`;
    if (this.searchQuery) return `Results for "${this.searchQuery}"`;
    if (this.activeCategoryLabel && this.selectedSubCategory) return `${this.activeCategoryLabel} — ${this.selectedSubCategory}`;
    if (this.activeCategoryLabel) return this.activeCategoryLabel;
    return 'All Auctions';
  }

  get pageFrom(): number { return this.total === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1; }
  get pageTo(): number { return Math.min(this.currentPage * this.pageSize, this.total); }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.selectedCategory = params['category'] || '';
      this.selectedSubCategory = params['subCategory'] || '';
      this.searchQuery = params['search'] || '';
      this.searchInput = this.searchQuery;
      this.sortBy = params['sort'] || 'deadline';
      this.currentPage = parseInt(params['page'] || '1', 10) || 1;
      this.loadListings();
    });
  }

  loadListings(): void {
    this.loading = true;
    this.error = null;

    const params: ListingsQueryParams = {
      sort: this.sortBy,
      status: 'active',
      limit: PAGE_SIZE,
      page: this.currentPage
    };

    if (this.selectedCategory) params.category = this.selectedCategory;
    if (this.selectedSubCategory) params.subCategory = this.selectedSubCategory;
    if (this.searchQuery) params.search = this.searchQuery;

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
    if (this.sortBy !== 'deadline') queryParams['sort'] = this.sortBy;
    if (this.currentPage > 1) queryParams['page'] = String(this.currentPage);
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
