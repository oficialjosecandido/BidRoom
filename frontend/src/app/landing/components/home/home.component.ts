import { Component, OnInit, OnDestroy, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { forkJoin, Subscription, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing, ListingsQueryParams, StatsOverview } from '../../../shared/services/listings.service';
import { SocketService } from '../../../shared/services/socket.service';
import { firstListingImageUrl } from '../../../shared/utils/listing-image-url';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private listingsService = inject(ListingsService);
  private socketService = inject(SocketService);

  /** Served from /public/images — used when remote image fails to load */
  readonly placeholderImg = '/images/placeholder-listing.svg';
  readonly heroImg = '/images/hero-marketplace.svg';

  endingSoonListings: Listing[] = [];
  newListings: Listing[] = [];
  feedListings: Listing[] = [];

  loading = true;
  feedLoading = false;
  loadingMore = false;
  loadError = false;
  sortBy: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' = 'deadline';
  selectedCategory = '';
  feedPage = 1;
  feedTotalPages = 1;
  readonly pageSize = 12;

  stats: StatsOverview = {
    totalBidders: 0,
    activeListings: 0,
    totalValueTraded: 0
  };

  searchQuery = '';

  readonly categoryRow = [
    { id: 'electronics' as const, icon: '📱', labelKey: 'home.categories.electronics.title' },
    { id: 'jewelry' as const, icon: '👗', labelKey: 'home.categoriesRow.fashion' },
    { id: 'jewelry' as const, icon: '⌚', labelKey: 'home.categoriesRow.watches' },
    { id: 'collectibles' as const, icon: '📬', labelKey: 'home.categories.collectibles.title' },
    { id: 'home-garden' as const, icon: '🏠', labelKey: 'home.categories.homeGarden.title' },
    { id: 'art' as const, icon: '✨', labelKey: 'home.categoriesRow.luxury' }
  ];

  private listingRefresh$ = new Subject<void>();
  private subs = new Subscription();
  private scrollGate = false;

  ngOnInit(): void {
    this.socketService.connect();
    this.loadStats();
    this.loadHomeData();

    this.subs.add(
      this.listingRefresh$.pipe(debounceTime(2000)).subscribe(() => {
        this.loadHomeData(true);
      })
    );
    this.subs.add(
      this.socketService.onListingUpdate().subscribe(() => this.listingRefresh$.next())
    );

    this.subs.add(
      this.route.fragment.subscribe((fragment) => {
        if (fragment === 'categories') {
          setTimeout(() => {
            document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 200);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.scrollGate || this.loading || this.loadingMore || this.feedPage >= this.feedTotalPages) return;
    const threshold = 500;
    const y = window.scrollY + window.innerHeight;
    const h = document.documentElement.scrollHeight;
    if (h - y < threshold) {
      this.scrollGate = true;
      this.loadMoreFeed();
      setTimeout(() => (this.scrollGate = false), 600);
    }
  }

  loadStats(): void {
    this.listingsService.getStats().subscribe({
      next: (stats) => (this.stats = stats),
      error: () => {}
    });
  }

  /** First image with API-relative paths resolved; never returns legacy `assets/` paths. */
  imageUrl(listing: Listing): string {
    return firstListingImageUrl(listing.images);
  }

  onListingImageError(event: Event): void {
    const el = event.target as HTMLImageElement | null;
    if (el && !el.src.includes('placeholder-listing.svg')) {
      el.src = this.placeholderImg;
    }
  }

  /**
   * Prefer distinct items in "New" vs "Ending soon" when possible; always use API data only.
   */
  private assignSectionLists(ending: Listing[], newest: Listing[], feed: Listing[]): void {
    const endingList = ending.slice(0, 6);
    const endingIds = new Set(endingList.map((l) => l._id));
    let newList = newest.filter((l) => !endingIds.has(l._id));
    if (newList.length === 0) {
      newList = newest.slice(0, 8);
    } else {
      newList = newList.slice(0, 8);
    }
    this.endingSoonListings = endingList;
    this.newListings = newList;
    this.feedListings = feed;
  }

  loadHomeData(silent = false): void {
    if (!silent) {
      this.loading = true;
    }
    this.loadError = false;

    const feedParams: ListingsQueryParams = {
      status: 'active',
      sort: this.sortBy,
      limit: this.pageSize,
      page: 1,
      ...(this.selectedCategory ? { category: this.selectedCategory } : {})
    };

    forkJoin({
      ending: this.listingsService.getListings({ status: 'active', sort: 'deadline', limit: 6 }),
      newest: this.listingsService.getListings({ status: 'active', sort: 'newest', limit: 12 }),
      feed: this.listingsService.getListings(feedParams)
    }).subscribe({
      next: ({ ending, newest, feed }) => {
        this.assignSectionLists(ending.listings, newest.listings, feed.listings);
        this.feedTotalPages = Math.max(1, feed.totalPages);
        this.feedPage = 1;
        this.loading = false;
      },
      error: () => {
        if (!silent) {
          this.endingSoonListings = [];
          this.newListings = [];
          this.feedListings = [];
          this.feedTotalPages = 1;
          this.feedPage = 1;
          this.loadError = true;
        }
        this.loading = false;
      }
    });
  }

  loadMoreFeed(): void {
    if (this.loadingMore || this.feedPage >= this.feedTotalPages) return;
    this.loadingMore = true;
    const nextPage = this.feedPage + 1;
    this.listingsService
      .getListings({
        status: 'active',
        sort: this.sortBy,
        limit: this.pageSize,
        page: nextPage,
        ...(this.selectedCategory ? { category: this.selectedCategory } : {})
      })
      .subscribe({
        next: (res) => {
          const chunk = res.listings.length > 0 ? res.listings : [];
          if (chunk.length > 0) {
            this.feedListings = [...this.feedListings, ...chunk];
          }
          this.feedPage = nextPage;
          this.feedTotalPages = Math.max(1, res.totalPages);
          this.loadingMore = false;
        },
        error: () => (this.loadingMore = false)
      });
  }

  onSortChange(): void {
    this.feedPage = 1;
    this.feedLoading = true;
    this.listingsService
      .getListings({
        status: 'active',
        sort: this.sortBy,
        limit: this.pageSize,
        page: 1,
        ...(this.selectedCategory ? { category: this.selectedCategory } : {})
      })
      .subscribe({
        next: (res) => {
          this.feedListings = res.listings;
          this.feedTotalPages = Math.max(1, res.totalPages);
          this.feedPage = 1;
          this.feedLoading = false;
        },
        error: () => {
          this.feedListings = [];
          this.feedTotalPages = 1;
          this.feedPage = 1;
          this.feedLoading = false;
        }
      });
  }

  filterCategory(cat: string): void {
    this.selectedCategory = cat;
    this.loadHomeData();
  }

  onSearch(): void {
    const q = this.searchQuery.trim();
    if (q) {
      this.router.navigate(['/listing/list'], { queryParams: { search: q } });
    } else {
      this.router.navigate(['/listing/list']);
    }
  }

  browseCategory(categoryId: string): void {
    this.router.navigate(['/listing/list'], { queryParams: { category: categoryId } });
  }

  browseCategoriesPage(): void {
    this.router.navigate(['/listing/categories']);
  }

  navigateToAddListing(): void {
    this.router.navigate(['/listing/add']);
  }

  scrollToExplore(): void {
    document.getElementById('explore-auctions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (!listing.timeRemaining) return '—';
    const { ended, days, hours, minutes } = listing.timeRemaining;
    if (ended) return 'Ended';
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  timerClass(listing: Listing): string {
    if (!listing.timeRemaining) return '';
    const { ended, days, hours } = listing.timeRemaining;
    if (ended) return '';
    if (days === 0 && hours < 1) return 'timer-urgent';
    if (days === 0 && hours < 24) return 'timer-soon';
    return 'timer-ok';
  }

  viewListing(slug: string | undefined): void {
    if (!slug) return;
    this.router.navigate(['/listing', slug]);
  }

  viewAllListings(): void {
    this.router.navigate(['/listing/list']);
  }

  retryLoad(): void {
    this.loadHomeData();
  }
}
