import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { ListingsService, Listing } from '../../../shared/services/listings.service';

@Component({
  selector: 'app-admin-auctions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, AdminSidebarComponent],
  templateUrl: './admin-auctions.component.html',
  styleUrls: ['./admin-auctions.component.scss']
})
export class AdminAuctionsComponent implements OnInit {
  private adminService = inject(AdminService);
  private listingsService = inject(ListingsService);

  auctions: Listing[] = [];
  filteredAuctions: Listing[] = [];
  isLoading = false;
  error: string | null = null;

  // Filters
  selectedCategory = 'all';
  selectedStatus = 'all';

  categories = [
    { value: 'all', label: 'All Categories' },
    { value: 'electronics', label: 'Electronics' },
    { value: 'art-collectibles', label: 'Art & Collectibles' },
    { value: 'jewelry', label: 'Jewelry' },
    { value: 'home-garden', label: 'Home & Garden' },
    { value: 'watches', label: 'Watches' },
    { value: 'fashion', label: 'Fashion' },
    { value: 'sports', label: 'Sports' },
    { value: 'books', label: 'Books' },
    { value: 'other', label: 'Other' }
  ];

  statuses = [
    { value: 'all', label: 'All Status' },
    { value: 'active', label: 'Active' },
    { value: 'ended', label: 'Ended' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'draft', label: 'Draft' }
  ];

  ngOnInit(): void {
    this.loadAuctions();
  }

  loadAuctions(): void {
    this.isLoading = true;
    this.error = null;

    this.adminService.getAuctions().subscribe({
      next: (auctions) => {
        this.auctions = auctions;
        this.applyFilters();
        this.isLoading = false;
      },
      error: (error) => {
        this.error = error?.message || 'Failed to load auctions';
        this.isLoading = false;
      }
    });
  }

  applyFilters(): void {
    this.filteredAuctions = this.auctions.filter(auction => {
      const categoryMatch = this.selectedCategory === 'all' || auction.category === this.selectedCategory;
      const statusMatch = this.selectedStatus === 'all' || auction.status === this.selectedStatus;
      return categoryMatch && statusMatch;
    });
  }

  onCategoryChange(): void {
    this.applyFilters();
  }

  onStatusChange(): void {
    this.applyFilters();
  }


  getStatusClass(status: string): string {
    const statusClasses: Record<string, string> = {
      'active': 'status-active',
      'ended': 'status-ended',
      'cancelled': 'status-cancelled',
      'draft': 'status-draft'
    };
    return statusClasses[status] || '';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

