import { Component, OnInit } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing, ListingsQueryParams } from '../../../shared/services/listings.service';

@Component({
  selector: 'app-listing-list',
  standalone: true,
  imports: [FormsModule, HeaderComponent, FooterComponent],
  templateUrl: './listing-list.component.html',
  styleUrls: ['./listing-list.component.scss']
})
export class ListingListComponent implements OnInit {
  listings: Listing[] = [];
  loading = true;
  error: string | null = null;
  sortBy: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' = 'deadline';
  selectedCategory: string = '';

  categories = ['Electronics', 'Art', 'Collectibles', 'Jewelry', 'Home & Garden', 'Watches', 'Fashion', 'Sports', 'Books', 'Other'];

  constructor(
    private router: Router,
    private listingsService: ListingsService
  ) {}

  ngOnInit(): void {
    this.loadListings();
  }

  loadListings(): void {
    this.loading = true;
    this.error = null;

    const params: ListingsQueryParams = {
      sort: this.sortBy,
      status: 'active',
      limit: 50
    };

    if (this.selectedCategory) {
      params.category = this.selectedCategory;
    }

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

  onCategoryChange(): void {
    this.loadListings();
  }

  viewListing(slug: string | undefined): void {
    if (!slug) {
      console.error('Listing slug is undefined');
      return;
    }
    this.router.navigate(['/listing', slug]);
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
}

