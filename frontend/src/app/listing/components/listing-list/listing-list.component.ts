import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, OnInit, OnDestroy, HostListener, inject, PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { getLocalizedTitle } from '../../../shared/utils/listing-locale';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing, ListingsQueryParams } from '../../../shared/services/listings.service';
import { WatchlistService } from '../../../shared/services/watchlist.service';
import { AuthService } from '../../../auth/services/auth.service';
import { CATEGORIES, Category } from '../../../shared/config/categories.config';
import { take } from 'rxjs/operators';
import { DisplayPricePipe } from '../../../shared/pipes/display-price.pipe';

const PAGE_SIZE = 20;

export const CONDITION_OPTIONS: { key: string; labelKey: string }[] = [
  { key: 'new',       labelKey: 'addListing.conditionNew' },
  { key: 'like-new',  labelKey: 'addListing.conditionUsedExcellent' },
  { key: 'very-good', labelKey: 'addListing.conditionUsedVeryGood' },
  { key: 'good',      labelKey: 'addListing.conditionUsedGood' },
  { key: 'fair',      labelKey: 'addListing.conditionUsedFair' },
  { key: 'for-parts', labelKey: 'addListing.conditionForParts' },
];

/** DB condition strings → filter keys (for display translation) */
const CONDITION_DB_TO_KEY: Record<string, string> = {
  'New': 'new',
  'Used - Excellent': 'like-new',
  'Used - Very Good': 'very-good',
  'Used - Good': 'good',
  'Used - Fair': 'fair',
  'For Parts or Not Working': 'for-parts',
};

export const SHIPPING_OPTIONS: { key: string; labelKey: string }[] = [
  { key: 'flat-rate', labelKey: 'addListing.shippingFlatRate' },
  { key: 'calculated', labelKey: 'addListing.shippingCalculated' },
  { key: 'local-pickup', labelKey: 'addListing.shippingLocalPickup' },
  { key: 'free', labelKey: 'addListing.shippingFree' },
];

type FormatFilter = 'all' | 'auction' | 'offer';
type ViewMode = 'grid' | 'list';
type StatusFilterKey = 'ending' | 'private';

@Component({
  selector: 'app-listing-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, RouterLink, HeaderComponent, FooterComponent, DisplayPricePipe],
  templateUrl: './listing-list.component.html',
  styleUrls: ['./listing-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ListingListComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private listingsService = inject(ListingsService);
  private watchlistService = inject(WatchlistService);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  listings: Listing[] = [];
  total = 0;
  totalPages = 1;
  currentPage = 1;
  loading = true;
  error: string | null = null;
  filtersOpen = false;
  viewMode: ViewMode = 'grid';

  sortBy: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' | 'recent-end' = 'deadline';
  listingStatusFilter: 'active' | 'ended' = 'active';
  formatFilter: FormatFilter = 'all';
  statusEnding = false;
  statusPrivate = false;
  selectedCategory = '';
  selectedSubCategory = '';
  searchQuery = '';
  searchInput = '';

  selectedConditions: Set<string> = new Set();
  selectedShipping: Set<string> = new Set();
  locationFilter = '';
  minPrice = '';
  maxPrice = '';
  activePricePreset = '';

  watchlistIds = new Set<string>();
  expandedCategories = new Set<string>();
  collapsedGroups: Record<string, boolean> = {
    category: false,
    format: false,
    status: false,
    price: false,
    condition: false,
    location: false,
  };

  readonly categories: Category[] = CATEGORIES;
  readonly pageSize = PAGE_SIZE;
  readonly conditionOptions = CONDITION_OPTIONS;
  readonly shippingOptions = SHIPPING_OPTIONS;

  readonly pricePresets = [
    { id: 'under500', labelKey: 'listingList.priceUnder500', min: 0, max: 500 },
    { id: '500-2k', labelKey: 'listingList.price500to2k', min: 500, max: 2000 },
    { id: '2k-10k', labelKey: 'listingList.price2kto10k', min: 2000, max: 10000 },
    { id: 'over10k', labelKey: 'listingList.priceOver10k', min: 10000, max: null as number | null },
  ];

  get subCategories(): string[] {
    const cat = this.categories.find(c => c.id === this.selectedCategory);
    return cat ? cat.subCategories : [];
  }

  get activeCategoryLabel(): string {
    if (!this.selectedCategory) return '';
    const key = this.categoryLabelKey(this.selectedCategory);
    const t = this.translate.instant(key);
    return t !== key ? t : (this.categories.find(c => c.id === this.selectedCategory)?.name ?? '');
  }

  get statusLive(): boolean {
    return this.listingStatusFilter === 'active' && !this.statusEnding && !this.statusPrivate;
  }

  get hasActiveFilters(): boolean {
    return !!(
      this.listingStatusFilter === 'ended' ||
      this.formatFilter !== 'all' ||
      this.statusEnding ||
      this.statusPrivate ||
      this.selectedConditions.size ||
      this.selectedShipping.size ||
      this.locationFilter.trim() ||
      this.minPrice ||
      this.maxPrice
    );
  }

  get activeFilterCount(): number {
    return (
      (this.listingStatusFilter === 'ended' ? 1 : 0) +
      (this.formatFilter !== 'all' ? 1 : 0) +
      (this.statusEnding ? 1 : 0) +
      (this.statusPrivate ? 1 : 0) +
      this.selectedConditions.size +
      (this.locationFilter.trim() ? 1 : 0) +
      (this.minPrice || this.maxPrice ? 1 : 0)
    );
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.selectedCategory = params['category'] || '';
      this.selectedSubCategory = params['subCategory'] || '';
      this.searchQuery = params['search'] || params['q'] || '';
      this.searchInput = this.searchQuery;
      this.listingStatusFilter = params['listingStatus'] === 'ended' ? 'ended' : 'active';
      this.formatFilter = (['all', 'auction', 'offer'].includes(params['format']) ? params['format'] : 'all') as FormatFilter;
      this.statusEnding = params['endingSoon'] === 'true';
      this.statusPrivate = params['privateRoom'] === 'true';

      let sort = (params['sort'] || 'deadline') as typeof this.sortBy;
      if (this.listingStatusFilter === 'ended' && (sort === 'deadline' || !params['sort'])) {
        sort = 'recent-end';
      }
      if (this.listingStatusFilter === 'active' && sort === 'recent-end') {
        sort = 'deadline';
      }
      this.sortBy = sort;
      this.currentPage = parseInt(params['page'] || '1', 10) || 1;
      this.selectedConditions = new Set((params['condition'] || '').split(',').filter(Boolean));
      this.locationFilter = params['location'] || params['locationCity'] || '';
      this.minPrice = params['minPrice'] || '';
      this.maxPrice = params['maxPrice'] || '';
      this.viewMode = params['view'] === 'list' ? 'list' : 'grid';
      if (this.selectedCategory) {
        this.expandedCategories = new Set([this.selectedCategory]);
      }
      this.loadListings();
      this.cdr.markForCheck();
    });

    this.authService.currentUser$.pipe(take(1)).subscribe(user => {
      if (user) this.loadWatchlistIds();
    });
  }

  loadWatchlistIds(): void {
    this.watchlistService.getMyWatchlist().subscribe({
      next: (res) => {
        this.watchlistIds = new Set((res.watchlist || []).map(l => l._id));
        this.cdr.markForCheck();
      },
      error: () => { /* non-critical */ }
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
    if (this.locationFilter.trim()) params.location = this.locationFilter.trim();
    if (this.minPrice) params.minPrice = parseFloat(this.minPrice);
    if (this.maxPrice) params.maxPrice = parseFloat(this.maxPrice);
    if (this.formatFilter === 'auction') params.auctionFormat = 'highest-bid';
    if (this.formatFilter === 'offer') params.auctionFormat = 'best-offer';
    if (this.statusEnding && this.listingStatusFilter === 'active') params.endingSoon = true;
    if (this.statusPrivate) params.allowPrivateRoom = true;

    this.listingsService.getListings(params).subscribe({
      next: (response) => {
        this.listings = response.listings;
        this.total = response.total;
        this.totalPages = response.totalPages || Math.ceil(response.total / PAGE_SIZE);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to load listings. Please try again.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private navigate(): void {
    const queryParams: Record<string, string> = {};
    if (this.selectedCategory) queryParams['category'] = this.selectedCategory;
    if (this.selectedSubCategory) queryParams['subCategory'] = this.selectedSubCategory;
    if (this.searchQuery) queryParams['search'] = this.searchQuery;
    if (this.listingStatusFilter === 'ended') queryParams['listingStatus'] = 'ended';
    if (this.formatFilter !== 'all') queryParams['format'] = this.formatFilter;
    if (this.statusEnding) queryParams['endingSoon'] = 'true';
    if (this.statusPrivate) queryParams['privateRoom'] = 'true';
    const defaultSort = this.listingStatusFilter === 'ended' ? 'recent-end' : 'deadline';
    if (this.sortBy !== defaultSort) queryParams['sort'] = this.sortBy;
    if (this.currentPage > 1) queryParams['page'] = String(this.currentPage);
    if (this.selectedConditions.size) queryParams['condition'] = [...this.selectedConditions].join(',');
    if (this.locationFilter.trim()) queryParams['location'] = this.locationFilter.trim();
    if (this.minPrice) queryParams['minPrice'] = this.minPrice;
    if (this.maxPrice) queryParams['maxPrice'] = this.maxPrice;
    if (this.viewMode === 'list') queryParams['view'] = 'list';
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

  categoryLabelKey(catId: string): string {
    return `addListing.categories.${catId}`;
  }

  subCategoryLabelKey(sub: string): string {
    return `addListing.subcategories.${sub}`;
  }

  categoryHasSubcategories(cat: Category): boolean {
    return cat.subCategories.length > 0;
  }

  isCategoryExpanded(catId: string): boolean {
    return this.expandedCategories.has(catId);
  }

  toggleCategoryExpand(catId: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    const next = new Set(this.expandedCategories);
    if (next.has(catId)) {
      next.delete(catId);
    } else {
      next.add(catId);
    }
    this.expandedCategories = next;
  }

  selectCategory(id: string): void {
    this.selectedCategory = id;
    this.selectedSubCategory = '';
    const cat = this.categories.find(c => c.id === id);
    if (cat?.subCategories.length) {
      this.expandedCategories = new Set([...this.expandedCategories, id]);
    }
    this.currentPage = 1;
    this.navigate();
  }

  selectSubCategory(sub: string, catId: string): void {
    this.selectedCategory = catId;
    this.selectedSubCategory = this.selectedSubCategory === sub ? '' : sub;
    this.expandedCategories = new Set([...this.expandedCategories, catId]);
    this.currentPage = 1;
    this.navigate();
  }

  setFormatFilter(fmt: FormatFilter): void {
    this.formatFilter = fmt;
    this.currentPage = 1;
    this.navigate();
  }

  formatFilterLabel(): string {
    if (this.formatFilter === 'auction') return this.translate.instant('listingList.formatAuction');
    if (this.formatFilter === 'offer') return this.translate.instant('listingList.formatBestOffer');
    return '';
  }

  toggleStatusLive(): void {
    this.listingStatusFilter = 'active';
    this.statusEnding = false;
    this.statusPrivate = false;
    if (this.sortBy === 'recent-end') this.sortBy = 'deadline';
    this.currentPage = 1;
    this.navigate();
  }

  toggleStatusEnding(): void {
    this.listingStatusFilter = 'active';
    this.statusEnding = !this.statusEnding;
    this.currentPage = 1;
    this.navigate();
  }

  toggleStatusPrivate(): void {
    this.listingStatusFilter = 'active';
    this.statusPrivate = !this.statusPrivate;
    this.currentPage = 1;
    this.navigate();
  }

  toggleStatusClosed(): void {
    if (this.listingStatusFilter === 'ended') {
      this.listingStatusFilter = 'active';
      if (this.sortBy === 'recent-end') this.sortBy = 'deadline';
    } else {
      this.listingStatusFilter = 'ended';
      if (this.sortBy === 'deadline') this.sortBy = 'recent-end';
    }
    this.currentPage = 1;
    this.navigate();
  }

  activeStatusLabels(): { key: StatusFilterKey; label: string }[] {
    const out: { key: StatusFilterKey; label: string }[] = [];
    if (this.statusEnding) out.push({ key: 'ending', label: this.translate.instant('listingList.statusEnding') });
    if (this.statusPrivate) out.push({ key: 'private', label: this.translate.instant('listingList.statusPrivate') });
    return out;
  }

  removeStatusFilter(key: StatusFilterKey): void {
    if (key === 'ending') this.statusEnding = false;
    if (key === 'private') this.statusPrivate = false;
    this.currentPage = 1;
    this.navigate();
  }

  toggleFilterGroup(id: string): void {
    this.collapsedGroups[id] = !this.collapsedGroups[id];
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.navigate();
  }

  applyPricePreset(preset: { id: string; min: number; max: number | null }): void {
    this.activePricePreset = preset.id;
    this.minPrice = preset.min > 0 ? String(preset.min) : '';
    this.maxPrice = preset.max != null ? String(preset.max) : '';
    this.currentPage = 1;
    this.navigate();
  }

  listingTitle(listing: Listing): string {
    return getLocalizedTitle(listing, this.translate.currentLang || 'pt');
  }

  priceChipLabel(): string {
    const min = this.minPrice ? `€${this.minPrice}` : '';
    const max = this.maxPrice ? `€${this.maxPrice}` : '';
    return `${min}${min && max ? ' – ' : ''}${max}`;
  }

  onSortChange(): void {
    this.currentPage = 1;
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

  onLocationFilterChange(): void {
    this.currentPage = 1;
    this.navigate();
  }

  clearLocationFilters(): void {
    this.locationFilter = '';
    this.currentPage = 1;
    this.navigate();
  }

  onPriceChange(): void {
    this.activePricePreset = '';
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
    this.locationFilter = '';
    this.minPrice = '';
    this.maxPrice = '';
    this.activePricePreset = '';
    this.formatFilter = 'all';
    this.statusEnding = false;
    this.statusPrivate = false;
    this.listingStatusFilter = 'active';
    if (this.sortBy === 'recent-end') this.sortBy = 'deadline';
    this.currentPage = 1;
    this.navigate();
  }

  clearListingStatusClosed(): void {
    this.listingStatusFilter = 'active';
    if (this.sortBy === 'recent-end') this.sortBy = 'deadline';
    this.currentPage = 1;
    this.navigate();
  }

  conditionLabel(key: string): string {
    const opt = this.conditionOptions.find(o => o.key === key);
    return opt ? this.translate.instant(opt.labelKey) : key;
  }

  displayCondition(raw: string | undefined): string {
    if (!raw) return '';
    const key = CONDITION_DB_TO_KEY[raw];
    if (key) return this.conditionLabel(key);
    return raw;
  }

  listingBadges(listing: Listing): { type: string; class: string; label: string }[] {
    const badges: { type: string; class: string; label: string }[] = [];
    if (listing.status === 'active') {
      if (listing.endingSoon) {
        badges.push({ type: 'end', class: 'lb-end', label: this.translate.instant('listingList.badgeClosing') });
      } else {
        badges.push({ type: 'live', class: 'lb-live', label: this.translate.instant('listingList.badgeLive') });
      }
    }
    // Private room first among format badges — high visibility for buyers.
    if (listing.allowPrivateRoom) {
      badges.push({ type: 'priv', class: 'lb-priv', label: this.translate.instant('listingList.badgePrivateRoom') });
    }
    if (listing.auctionFormat === 'best-offer') {
      badges.push({ type: 'off', class: 'lb-off', label: this.translate.instant('listingList.badgeBestOffer') });
    } else if (!listing.allowPrivateRoom) {
      // Skip redundant "Auction" label when private-room already signals auction format.
      badges.push({ type: 'auc', class: 'lb-auc', label: this.translate.instant('listingList.badgeAuction') });
    }
    return badges;
  }

  listingMetaLine(listing: Listing): string {
    const catId = listing.category;
    const catKey = catId ? this.categoryLabelKey(catId) : '';
    const catTranslated = catKey ? this.translate.instant(catKey) : '';
    const cat = catTranslated !== catKey ? catTranslated : (this.categories.find(c => c.id === catId)?.name || catId);
    const loc = listing.location?.trim() || '';
    const cond = this.displayCondition(listing.condition);
    return [cat, loc, cond].filter(Boolean).join(' · ');
  }

  priceLabel(listing: Listing): string {
    return listing.auctionFormat === 'best-offer'
      ? this.translate.instant('listingList.minPrice')
      : this.translate.instant('listingList.currentBid');
  }

  bidCountLabel(listing: Listing): string {
    if (listing.auctionFormat === 'best-offer') {
      const n = listing.bidCount || 0;
      return n === 1
        ? this.translate.instant('listingList.oneOffer')
        : this.translate.instant('listingList.offersCount', { count: n });
    }
    const n = listing.bidCount || 0;
    return n === 1
      ? this.translate.instant('listingList.oneBid')
      : this.translate.instant('listingList.bidsCount', { count: n });
  }

  viewCountLabel(listing: Listing): string {
    const n = listing.viewCount ?? 0;
    return n === 1
      ? this.translate.instant('listingList.oneView')
      : this.translate.instant('listingList.viewsCount', { count: n });
  }

  isEndingTimer(listing: Listing): boolean {
    if (!listing.timeRemaining || listing.timeRemaining.ended) return false;
    return listing.endingSoon === true || (listing.timeRemaining.days === 0 && listing.timeRemaining.hours < 1);
  }

  isInWatchlist(id: string): boolean {
    return this.watchlistIds.has(id);
  }

  toggleWatchlist(event: Event, listing: Listing): void {
    event.stopPropagation();
    event.preventDefault();
    const id = listing._id;
    if (this.watchlistIds.has(id)) {
      this.watchlistService.remove(id).subscribe({
        next: () => {
          this.watchlistIds.delete(id);
          this.watchlistIds = new Set(this.watchlistIds);
          this.cdr.markForCheck();
        }
      });
    } else {
      this.watchlistService.add(id).subscribe({
        next: () => {
          this.watchlistIds.add(id);
          this.watchlistIds = new Set(this.watchlistIds);
          this.cdr.markForCheck();
        }
      });
    }
  }

  viewListing(slug: string | undefined): void {
    if (!slug) return;
    this.router.navigate(['/listing', slug]);
  }

  formatPrice(price: number): string {
    return new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price ?? 0);
  }

  formatTimeRemaining(listing: Listing): string {
    if (!listing.timeRemaining) return this.translate.instant('listingList.na');
    const { ended, days, hours, minutes, totalMs } = listing.timeRemaining;
    if (ended) return this.translate.instant('listingList.ended');
    if (listing.auctionFormat === 'best-offer' && days > 0) {
      return this.translate.instant('listingList.hoursLeft', { hours: days * 24 + hours });
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    const totalSecs = totalMs != null
      ? Math.max(0, Math.floor(totalMs / 1000))
      : (days * 86400) + (hours * 3600) + (minutes * 60);
    if (totalSecs < 86400) {
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = totalSecs % 60;
      return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  toggleFilters(): void {
    this.filtersOpen = !this.filtersOpen;
    this.syncBodyScroll();
  }

  closeFilters(): void {
    if (!this.filtersOpen) return;
    this.filtersOpen = false;
    this.syncBodyScroll();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeFilters();
  }

  ngOnDestroy(): void {
    if (this.isBrowser) document.body.style.overflow = '';
  }

  private syncBodyScroll(): void {
    if (!this.isBrowser) return;
    document.body.style.overflow = this.filtersOpen ? 'hidden' : '';
  }
}
