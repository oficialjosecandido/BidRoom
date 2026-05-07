import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { Listing } from '../../../shared/services/listings.service';

@Component({
  selector: 'app-admin-auctions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, AdminSidebarComponent],
  templateUrl: './admin-auctions.component.html',
  styleUrls: ['./admin-auctions.component.scss']
})
export class AdminAuctionsComponent implements OnInit {
  private adminService = inject(AdminService);

  auctions: Listing[] = [];
  isLoading = false;
  error: string | null = null;

  page = 1;
  readonly pageSize = 25;
  total = 0;
  totalPages = 0;

  selectedCategory = 'all';
  selectedStatus = 'all';

  categories = [
    { value: 'all', label: 'All categories' },
    { value: 'electronics', label: 'Electronics' },
    { value: 'home-garden', label: 'Home & Garden' },
    { value: 'art', label: 'Art' },
    { value: 'collectibles', label: 'Collectibles' },
    { value: 'jewelry', label: 'Jewelry' }
  ];

  statuses = [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'ended', label: 'Ended' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'draft', label: 'Draft' }
  ];

  private readonly categoryLabelMap: Record<string, string> = {
    electronics: 'Electronics',
    'home-garden': 'Home & Garden',
    art: 'Art',
    collectibles: 'Collectibles',
    jewelry: 'Jewelry'
  };

  ngOnInit(): void {
    this.loadAuctions();
  }

  loadAuctions(): void {
    this.isLoading = true;
    this.error = null;

    this.adminService
      .getAuctions({
        page: this.page,
        limit: this.pageSize,
        category: this.selectedCategory,
        status: this.selectedStatus
      })
      .subscribe({
        next: (res) => {
          this.auctions = res.auctions ?? [];
          this.total = res.total ?? 0;
          this.totalPages = Math.max(1, res.pages ?? 1);
          this.page = Math.max(1, Math.min(res.page ?? 1, this.totalPages));
          this.isLoading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || err?.message || 'Failed to load auctions';
          this.isLoading = false;
        }
      });
  }

  filterChanged(): void {
    this.page = 1;
    this.loadAuctions();
  }

  goToPage(delta: number): void {
    const next = Math.min(Math.max(1, this.page + delta), Math.max(this.totalPages, 1));
    if (next === this.page) return;
    this.page = next;
    this.loadAuctions();
  }

  categoryLabel(cat: string | undefined): string {
    if (!cat) return '—';
    return this.categoryLabelMap[cat] ?? cat.replace(/-/g, ' ');
  }

  getStatusClass(status: string): string {
    const statusClasses: Record<string, string> = {
      active: 'status-active',
      ended: 'status-ended',
      cancelled: 'status-cancelled',
      draft: 'status-draft'
    };
    return statusClasses[status] || '';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  bidCount(auction: Listing): number {
    return auction.bidCount ?? 0;
  }
}
