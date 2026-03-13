import { Component, OnInit, AfterViewInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing, ListingsQueryParams, StatsOverview } from '../../../shared/services/listings.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, AfterViewInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private listingsService = inject(ListingsService);

  listings: Listing[] = [];
  loading = true;
  error: string | null = null;
  sortBy: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' = 'deadline';
  stats: StatsOverview = {
    totalBidders: 0,
    activeListings: 0,
    totalValueTraded: 0
  };

  ngOnInit(): void {
    this.loadStats();
    this.loadListings();
  }

  ngAfterViewInit(): void {
    // Handle fragment navigation (e.g., #categories)
    this.route.fragment.subscribe(fragment => {
      if (fragment === 'categories') {
        setTimeout(() => {
          const element = document.getElementById('categories');
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }
    });
  }

  loadStats(): void {
    this.listingsService.getStats().subscribe({
      next: (stats) => {
        this.stats = stats;
      },
      error: (err) => {
        console.error('Error loading stats:', err);
        // Use default values on error
      }
    });
  }

  loadListings(): void {
    this.loading = true;
    this.error = null;

    const params: ListingsQueryParams = {
      sort: this.sortBy,
      status: 'active',
      limit: 50
    };

    this.listingsService.getListings(params).subscribe({
      next: (response) => {
        this.listings = response.listings;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading listings:', err);
        this.error = 'Failed to load listings. Please try again later.';
        this.loading = false;
      }
    });
  }

  onSortChange(): void {
    this.loadListings();
  }

  searchQuery = '';

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

  navigateToAuth(): void {
    this.router.navigate(['/auth/signup']);
  }

  navigateToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  navigateToAddListing(): void {
    this.router.navigate(['/listing/add']);
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
    
    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  getEndingSoonListings(): Listing[] {
    return this.listings
      .filter(listing => listing.endingSoon && listing.status === 'active')
      .slice(0, 3);
  }

  viewListing(slug: string | undefined): void {
    if (!slug) {
      console.error('Listing slug is undefined');
      return;
    }
    this.router.navigate(['/listing', slug]);
  }
}
