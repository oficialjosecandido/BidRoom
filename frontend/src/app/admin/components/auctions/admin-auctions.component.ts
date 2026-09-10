import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminService, AdminCreateAuctionPayload } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { Listing } from '../../../shared/services/listings.service';

type ReportReason =
  | 'fraud_scam'
  | 'offensive_content'
  | 'prohibited_item'
  | 'spam'
  | 'off_platform_transaction'
  | 'other';

@Component({
  selector: 'app-admin-auctions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, AdminSidebarComponent],
  templateUrl: './admin-auctions.component.html',
  styleUrls: ['./admin-auctions.component.scss']
})
export class AdminAuctionsComponent implements OnInit {
  private adminService = inject(AdminService);
  private destroyRef = inject(DestroyRef);
  private search$ = new Subject<string>();

  auctions: Listing[] = [];
  isLoading = false;
  error: string | null = null;

  page = 1;
  readonly pageSize = 25;
  total = 0;
  totalPages = 0;

  selectedCategory = 'all';
  selectedStatus = 'all';
  searchQuery = '';

  showCreateModal = false;
  showImportModal = false;
  showReportModal = false;
  createSubmitting = false;
  importSubmitting = false;
  reportSubmitting = false;

  createForm: AdminCreateAuctionPayload = this.emptyCreateForm();
  importFile: File | null = null;
  importPreviewName = '';

  reportTarget: Listing | null = null;
  reportReason: ReportReason = 'other';
  reportDescription = '';
  readonly reportReasons: { value: ReportReason; label: string }[] = [
    { value: 'fraud_scam', label: 'Fraud / scam' },
    { value: 'offensive_content', label: 'Offensive content' },
    { value: 'prohibited_item', label: 'Prohibited item' },
    { value: 'spam', label: 'Spam' },
    { value: 'off_platform_transaction', label: 'Off-platform transaction' },
    { value: 'other', label: 'Other' }
  ];

  categories = [
    { value: 'all', label: 'All categories' },
    { value: 'electronics', label: 'Electronics' },
    { value: 'home-garden', label: 'Home & Garden' },
    { value: 'art', label: 'Art' },
    { value: 'collectibles', label: 'Collectibles' },
    { value: 'jewelry', label: 'Jewelry' },
    { value: 'vehicles', label: 'Vehicles' }
  ];

  createCategories = this.categories.filter((c) => c.value !== 'all');

  statuses = [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'ended', label: 'Ended' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'draft', label: 'Draft' }
  ];

  conditions = [
    'New',
    'Used - Excellent',
    'Used - Very Good',
    'Used - Good',
    'Used - Fair',
    'For Parts or Not Working'
  ];

  durations = ['24 hours', '3 days', '7 days', '10 days', '15 days', '30 days'];

  private readonly categoryLabelMap: Record<string, string> = {
    electronics: 'Electronics',
    'home-garden': 'Home & Garden',
    art: 'Art',
    collectibles: 'Collectibles',
    jewelry: 'Jewelry',
    vehicles: 'Vehicles',
    'real-estate': 'Real Estate'
  };

  ngOnInit(): void {
    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.page = 1;
      this.loadAuctions();
    });
    this.loadAuctions();
  }

  private emptyCreateForm(): AdminCreateAuctionPayload {
    return {
      sellerEmail: '',
      title: '',
      description: '',
      category: 'jewelry',
      subCategory: 'Luxury Watches',
      condition: 'Used - Excellent',
      listingFormat: 'highest-bid',
      startingPrice: 0,
      duration: '7 days',
      shippingOption: 'flat-rate',
      shippingCost: 0,
      returnPolicy: 'no-returns',
      locationCity: 'Lisboa',
      locationCountry: 'PT',
      allowPrivateRoom: false
    };
  }

  loadAuctions(): void {
    this.isLoading = true;
    this.error = null;

    this.adminService
      .getAuctions({
        page: this.page,
        limit: this.pageSize,
        category: this.selectedCategory,
        status: this.selectedStatus,
        q: this.searchQuery.trim() || undefined
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

  onSearchChange(value: string): void {
    this.searchQuery = value;
    this.search$.next(value.trim());
  }

  clearSearch(): void {
    if (!this.searchQuery) return;
    this.searchQuery = '';
    this.search$.next('');
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

  deletingId: string | null = null;

  deleteListing(auction: Listing, event: Event): void {
    event.stopPropagation();
    if (this.deletingId) return;
    if (!confirm(`Delete "${auction.title}"? This permanently removes the listing and all its bids. Active transactions will block deletion.`)) return;
    this.deletingId = auction._id;
    this.adminService.deleteListing(auction._id).subscribe({
      next: () => {
        this.auctions = this.auctions.filter(a => a._id !== auction._id);
        this.total = Math.max(0, this.total - 1);
        this.deletingId = null;
      },
      error: (err) => {
        this.deletingId = null;
        alert(err?.error?.message || 'Failed to delete listing.');
      }
    });
  }

  bidCount(auction: Listing): number {
    return auction.bidCount ?? 0;
  }

  privateRoomApplies(auction: Listing): boolean {
    return (auction.auctionFormat ?? 'highest-bid') === 'highest-bid';
  }

  auctionFormatLabel(auction: Listing): string {
    const fmt = auction.auctionFormat ?? 'highest-bid';
    if (fmt === 'best-offer') return 'Best offer';
    return 'Highest bid';
  }

  openCreateModal(): void {
    this.createForm = this.emptyCreateForm();
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    if (this.createSubmitting) return;
    this.showCreateModal = false;
  }

  submitCreate(): void {
    if (this.createSubmitting) return;
    const title = (this.createForm.title || '').trim();
    const description = (this.createForm.description || '').trim();
    const sellerEmail = (this.createForm.sellerEmail || '').trim();
    if (!sellerEmail) {
      alert('Seller email is required.');
      return;
    }
    if (!title) {
      alert('Title is required.');
      return;
    }
    if (description.length < 50) {
      alert('Description must be at least 50 characters.');
      return;
    }

    this.createSubmitting = true;
    this.adminService.createAuction({
      ...this.createForm,
      sellerEmail,
      title,
      description,
      startingPrice: Number(this.createForm.startingPrice) || 0,
      shippingCost: Number(this.createForm.shippingCost) || 0
    }).subscribe({
      next: (res) => {
        this.createSubmitting = false;
        this.showCreateModal = false;
        alert(`Success: auction "${res.listing.title}" created.`);
        this.page = 1;
        this.loadAuctions();
      },
      error: (err) => {
        this.createSubmitting = false;
        alert(`Fail: ${err?.error?.message || err?.message || 'Could not create auction.'}`);
      }
    });
  }

  openImportModal(): void {
    this.importFile = null;
    this.importPreviewName = '';
    this.showImportModal = true;
  }

  closeImportModal(): void {
    if (this.importSubmitting) return;
    this.showImportModal = false;
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.importFile = file;
    this.importPreviewName = file?.name || '';
  }

  downloadCsvTemplate(): void {
    const header = [
      'sellerEmail',
      'title',
      'description',
      'category',
      'subCategory',
      'condition',
      'listingFormat',
      'startingPrice',
      'duration',
      'shippingOption',
      'shippingCost',
      'returnPolicy',
      'locationCity',
      'locationCountry',
      'images',
      'allowPrivateRoom'
    ].join(',');
    const sample = [
      'seller@example.com',
      '"Sample Watch Title"',
      '"Detailed description with at least fifty characters so validation passes easily."',
      'jewelry',
      '"Luxury Watches"',
      '"Used - Excellent"',
      'highest-bid',
      '100',
      '"7 days"',
      'flat-rate',
      '10',
      'no-returns',
      'Lisboa',
      'PT',
      '',
      'false'
    ].join(',');
    const blob = new Blob([`${header}\n${sample}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bidroom-auctions-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  submitImport(): void {
    if (this.importSubmitting) return;
    if (!this.importFile) {
      alert('Choose a CSV file first.');
      return;
    }
    this.importSubmitting = true;
    this.adminService.importAuctionsCsv(this.importFile).subscribe({
      next: (res) => {
        this.importSubmitting = false;
        this.showImportModal = false;
        if (res.failed === 0) {
          alert(`Success: imported ${res.created} auction(s).`);
        } else {
          const firstError = res.results.find((r) => !r.ok)?.error;
          alert(
            `Partial fail: created ${res.created}, failed ${res.failed}.` +
            (firstError ? `\nFirst error: ${firstError}` : '')
          );
        }
        this.page = 1;
        this.loadAuctions();
      },
      error: (err) => {
        this.importSubmitting = false;
        alert(`Fail: ${err?.error?.message || err?.message || 'CSV import failed.'}`);
      }
    });
  }

  openReport(auction: Listing, event: Event): void {
    event.stopPropagation();
    this.reportTarget = auction;
    this.reportReason = 'other';
    this.reportDescription = '';
    this.showReportModal = true;
  }

  closeReportModal(): void {
    if (this.reportSubmitting) return;
    this.showReportModal = false;
    this.reportTarget = null;
  }

  submitReport(): void {
    if (this.reportSubmitting || !this.reportTarget) return;
    this.reportSubmitting = true;
    this.adminService.createReport({
      reportType: 'listing',
      targetId: this.reportTarget._id,
      reason: this.reportReason,
      description: this.reportDescription.trim() || undefined
    }).subscribe({
      next: () => {
        this.reportSubmitting = false;
        this.showReportModal = false;
        const title = this.reportTarget?.title || 'listing';
        this.reportTarget = null;
        alert(`Success: report submitted for "${title}".`);
      },
      error: (err) => {
        this.reportSubmitting = false;
        alert(`Fail: ${err?.error?.message || err?.message || 'Could not submit report.'}`);
      }
    });
  }
}
