import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { CustomerService, CustomerInfo } from '../../../shared/services/customer.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-home.component.html',
  styleUrls: ['./dashboard-home.component.scss']
})
export class DashboardHomeComponent implements OnInit {
  currentUser$: Observable<AppUser | null>;
  customer: CustomerInfo | null = null;
  activeListings: Listing[] = [];
  endedListings: Listing[] = [];
  isLoading = true;
  error: string | null = null;

  balance = 0;
  reviewCount = 0;

  constructor(
    private authService: AuthService,
    private listingsService: ListingsService,
    private customerService: CustomerService
  ) {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    this.loadCustomer();
    this.loadMyListings();
  }

  loadCustomer(): void {
    this.customerService.getCustomer().subscribe({
      next: (info) => {
        this.customer = info;
        this.balance = info.balance ?? 0;
        this.reviewCount = info.reviewCount ?? 0;
      },
      error: () => {
        this.balance = 0;
        this.reviewCount = 0;
      }
    });
  }

  loadMyListings(): void {
    this.isLoading = true;
    this.error = null;

    this.listingsService.getMyListings().subscribe({
      next: (response) => {
        const all = response.listings || [];
        const now = new Date();
        this.activeListings = all.filter(
          (l) => l.status === 'active' && new Date(l.endDate) > now
        );
        this.endedListings = all.filter(
          (l) => l.status === 'ended' || l.status === 'cancelled' || (l.status === 'active' && new Date(l.endDate) <= now)
        );
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load your listings';
        this.isLoading = false;
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatPrice(value: number): string {
    return '$' + value.toFixed(2);
  }
}
