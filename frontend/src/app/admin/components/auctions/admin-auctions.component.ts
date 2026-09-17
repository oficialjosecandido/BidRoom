import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminService, AdminCreateAuctionPayload } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { Listing } from '../../../shared/services/listings.service';
import { API_CONFIG } from '../../../shared/config/api.config';

type ReportReason =
  | 'fraud_scam'
  | 'offensive_content'
  | 'prohibited_item'
  | 'spam'
  | 'off_platform_transaction'
  | 'other';

type CreateLangCode = 'pt' | 'en' | 'es' | 'fr';

interface CreateLangTab {
  code: CreateLangCode;
  label: string;
  titleField: 'title' | 'titleEn' | 'titleEs' | 'titleFr';
  descriptionField: 'description' | 'descriptionEn' | 'descriptionEs' | 'descriptionFr';
  required: boolean;
}

interface CreatePhoto {
  id: number;
  file: File;
  previewUrl: string;
  /** Set once the file is in Blob Storage, so a failed create can be retried without re-uploading. */
  uploadedUrl?: string;
}

/** Same limits as the seller flow and POST /api/uploads. */
const MAX_CREATE_PHOTOS = 20;
const MAX_CREATE_PHOTO_BYTES = 5 * 1024 * 1024;
const CREATE_PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
/** POST /api/uploads accepts at most 10 files per request. */
const UPLOAD_BATCH_SIZE = 10;

@Component({
  selector: 'app-admin-auctions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, AdminSidebarComponent],
  templateUrl: './admin-auctions.component.html',
  styleUrls: ['./admin-auctions.component.scss']
})
export class AdminAuctionsComponent implements OnInit {
  private adminService = inject(AdminService);
  private http = inject(HttpClient);
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
  showCreateConfirm = false;
  showImportModal = false;
  showReportModal = false;
  createSubmitting = false;
  importSubmitting = false;
  reportSubmitting = false;

  /** UI-only: auction type includes giveaway for the create form. */
  createSaleType: 'highest-bid' | 'best-offer' | 'giveaway' = 'highest-bid';

  createForm: AdminCreateAuctionPayload = this.emptyCreateForm();

  readonly createLangTabs: CreateLangTab[] = [
    { code: 'pt', label: 'Português', titleField: 'title', descriptionField: 'description', required: true },
    { code: 'en', label: 'English', titleField: 'titleEn', descriptionField: 'descriptionEn', required: false },
    { code: 'es', label: 'Español', titleField: 'titleEs', descriptionField: 'descriptionEs', required: false },
    { code: 'fr', label: 'Français', titleField: 'titleFr', descriptionField: 'descriptionFr', required: false }
  ];
  activeCreateLang: CreateLangCode = 'pt';
  /** Language shown in the confirm-step preview. */
  previewLang: CreateLangCode = 'pt';

  readonly maxCreatePhotos = MAX_CREATE_PHOTOS;
  createPhotos: CreatePhoto[] = [];
  createPhotoErrors: string[] = [];
  createPhotoDragOver = false;
  createUploadProgress: { done: number; total: number } | null = null;
  private nextCreatePhotoId = 1;

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
    // First in the list: this is the queue that needs someone to act on it.
    { value: 'pending_review', label: 'Awaiting approval' },
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
    this.destroyRef.onDestroy(() => this.clearCreatePhotos());
    this.loadAuctions();
  }

  private emptyCreateForm(): AdminCreateAuctionPayload {
    return {
      sellerEmail: '',
      title: '',
      titleEn: '',
      titleEs: '',
      titleFr: '',
      description: '',
      descriptionEn: '',
      descriptionEs: '',
      descriptionFr: '',
      category: 'jewelry',
      subCategory: 'Luxury Watches',
      condition: 'Used - Excellent',
      saleFormat: 'auction',
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

  get isGiveawayCreate(): boolean {
    return this.createSaleType === 'giveaway';
  }

  get canAllowPrivateRoom(): boolean {
    return this.createSaleType === 'highest-bid';
  }

  /** Locale checklist shown in the confirm step. */
  get localeChecklist(): { code: string; label: string; title: boolean; description: boolean }[] {
    return this.createLangTabs.map((tab) => ({
      code: tab.code,
      label: tab.label,
      title: !!this.langTitle(tab),
      description: !!this.langDescription(tab)
    }));
  }

  langTitle(tab: CreateLangTab): string {
    return (this.createForm[tab.titleField] || '').trim();
  }

  langDescription(tab: CreateLangTab): string {
    return (this.createForm[tab.descriptionField] || '').trim();
  }

  /** complete = title and description; partial = only one of them; empty = falls back to PT on the site. */
  langStatus(tab: CreateLangTab): 'complete' | 'partial' | 'empty' {
    const title = !!this.langTitle(tab);
    const description = !!this.langDescription(tab);
    if (title && description) return 'complete';
    return title || description ? 'partial' : 'empty';
  }

  get previewTab(): CreateLangTab {
    return this.createLangTabs.find((t) => t.code === this.previewLang) ?? this.createLangTabs[0];
  }

  /** What the site shows for the preview language, mirroring getLocalizedTitle/Description's PT fallback. */
  get previewContent(): { title: string; description: string; titleFallback: boolean; descriptionFallback: boolean } {
    const pt = this.createLangTabs[0];
    const tab = this.previewTab;
    const title = this.langTitle(tab);
    const description = this.langDescription(tab);
    return {
      title: title || this.langTitle(pt),
      description: description || this.langDescription(pt),
      titleFallback: !title,
      descriptionFallback: !description
    };
  }

  // ---- Create: photos ------------------------------------------------------

  onCreatePhotosSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addCreatePhotos(Array.from(input.files ?? []));
    // Reset so picking the same file again after removing it still fires `change`.
    input.value = '';
  }

  onCreatePhotosDragOver(event: DragEvent): void {
    event.preventDefault();
    this.createPhotoDragOver = true;
  }

  onCreatePhotosDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.createPhotoDragOver = false;
  }

  onCreatePhotosDropped(event: DragEvent): void {
    event.preventDefault();
    this.createPhotoDragOver = false;
    if (this.createSubmitting) return;
    this.addCreatePhotos(Array.from(event.dataTransfer?.files ?? []));
  }

  private addCreatePhotos(files: File[]): void {
    this.createPhotoErrors = [];
    for (const file of files) {
      if (!CREATE_PHOTO_TYPES.includes(file.type)) {
        this.createPhotoErrors.push(`${file.name}: not a supported image (JPEG, PNG, GIF, WebP, BMP).`);
        continue;
      }
      if (file.size > MAX_CREATE_PHOTO_BYTES) {
        this.createPhotoErrors.push(`${file.name}: larger than 5 MB.`);
        continue;
      }
      if (this.createPhotos.length >= MAX_CREATE_PHOTOS) {
        this.createPhotoErrors.push(`${file.name}: limit of ${MAX_CREATE_PHOTOS} photos reached.`);
        continue;
      }
      const duplicate = this.createPhotos.some(
        (p) => p.file.name === file.name && p.file.size === file.size && p.file.lastModified === file.lastModified
      );
      if (duplicate) continue;
      this.createPhotos.push({ id: this.nextCreatePhotoId++, file, previewUrl: URL.createObjectURL(file) });
    }
  }

  removeCreatePhoto(index: number): void {
    if (this.createSubmitting) return;
    const [removed] = this.createPhotos.splice(index, 1);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
  }

  /** Moves a photo by `delta` positions; the first photo is the cover. */
  moveCreatePhoto(index: number, delta: number): void {
    if (this.createSubmitting) return;
    const target = index + delta;
    if (target < 0 || target >= this.createPhotos.length) return;
    const [photo] = this.createPhotos.splice(index, 1);
    this.createPhotos.splice(target, 0, photo);
  }

  makeCreatePhotoCover(index: number): void {
    this.moveCreatePhoto(index, -index);
  }

  private clearCreatePhotos(): void {
    this.createPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    this.createPhotos = [];
    this.createPhotoErrors = [];
    this.createPhotoDragOver = false;
    this.createUploadProgress = null;
  }

  /**
   * Uploads photos that are not in Blob Storage yet, in batches the upload
   * endpoint accepts, and returns every URL in display order (cover first).
   */
  private async uploadCreatePhotos(): Promise<string[]> {
    const total = this.createPhotos.length;
    const pending = this.createPhotos.filter((p) => !p.uploadedUrl);
    let done = total - pending.length;
    this.createUploadProgress = { done, total };

    for (let i = 0; i < pending.length; i += UPLOAD_BATCH_SIZE) {
      const batch = pending.slice(i, i + UPLOAD_BATCH_SIZE);
      const formData = new FormData();
      batch.forEach((p) => formData.append('images', p.file, p.file.name));
      const res = await firstValueFrom(
        this.http.post<{ urls: string[] }>(`${API_CONFIG.getApiUrl()}/uploads`, formData)
      );
      const urls = res?.urls ?? [];
      if (urls.length !== batch.length) {
        throw new Error('The upload service returned an unexpected number of photos. Please try again.');
      }
      batch.forEach((p, idx) => (p.uploadedUrl = urls[idx]));
      done += batch.length;
      this.createUploadProgress = { done, total };
    }

    return this.createPhotos.map((p) => p.uploadedUrl as string);
  }

  onSaleTypeChange(): void {
    if (this.createSaleType === 'giveaway') {
      this.createForm.saleFormat = 'giveaway';
      this.createForm.listingFormat = 'highest-bid';
      this.createForm.allowPrivateRoom = false;
      this.createForm.startingPrice = 0;
      if (this.createForm.shippingOption !== 'free' && this.createForm.shippingOption !== 'local-pickup') {
        this.createForm.shippingOption = 'free';
      }
      this.createForm.shippingCost = 0;
      this.createForm.returnPolicy = 'no-returns';
      return;
    }
    this.createForm.saleFormat = 'auction';
    this.createForm.listingFormat = this.createSaleType;
    if (this.createSaleType === 'best-offer') {
      this.createForm.allowPrivateRoom = false;
    }
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
      draft: 'status-draft',
      pending_review: 'status-pending-review'
    };
    return statusClasses[status] || '';
  }

  statusLabel(status: string): string {
    return status === 'pending_review' ? 'awaiting approval' : status;
  }

  // ---- Manual review -------------------------------------------------------

  /** Id of the listing currently being approved or rejected, so only its row is disabled. */
  reviewingId: string | null = null;
  rejectTarget: Listing | null = null;
  rejectReason = '';
  reviewError: string | null = null;

  approve(listing: Listing): void {
    // Approving starts the auction clock and makes the listing public — both
    // hard to walk back, so it is worth one deliberate confirmation.
    const ends = listing.durationSlot ? ` The auction will run for ${listing.durationSlot} from now.` : '';
    if (!confirm(`Approve "${listing.title}"? It goes live immediately.${ends}`)) return;

    this.reviewingId = listing._id;
    this.reviewError = null;
    this.adminService.approveListing(listing._id).subscribe({
      next: () => {
        this.reviewingId = null;
        this.loadAuctions();
      },
      error: (err) => {
        this.reviewingId = null;
        this.reviewError = err?.error?.error || err?.message || 'Failed to approve listing';
      }
    });
  }

  openRejectModal(listing: Listing): void {
    this.rejectTarget = listing;
    this.rejectReason = '';
    this.reviewError = null;
  }

  closeRejectModal(): void {
    this.rejectTarget = null;
    this.rejectReason = '';
  }

  confirmReject(): void {
    const target = this.rejectTarget;
    const reason = this.rejectReason.trim();
    // The reason is emailed to the seller as their instruction on what to fix,
    // so an empty one would leave them with a rejection and no next step.
    if (!target || !reason) return;

    this.reviewingId = target._id;
    this.reviewError = null;
    this.adminService.rejectListing(target._id, reason).subscribe({
      next: () => {
        this.reviewingId = null;
        this.closeRejectModal();
        this.loadAuctions();
      },
      error: (err) => {
        this.reviewingId = null;
        this.reviewError = err?.error?.error || err?.message || 'Failed to reject listing';
      }
    });
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
    this.createSaleType = 'highest-bid';
    this.activeCreateLang = 'pt';
    this.previewLang = 'pt';
    this.clearCreatePhotos();
    this.showCreateConfirm = false;
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    if (this.createSubmitting) return;
    this.clearCreatePhotos();
    this.showCreateModal = false;
    this.showCreateConfirm = false;
  }

  /** Validate form then open the multilingual confirm step. */
  requestCreateConfirm(): void {
    if (this.createSubmitting) return;
    const title = (this.createForm.title || '').trim();
    const description = (this.createForm.description || '').trim();
    const sellerEmail = (this.createForm.sellerEmail || '').trim();
    if (!sellerEmail) {
      alert('Seller email is required (existing customer or a new email).');
      return;
    }
    if (!title) {
      this.activeCreateLang = 'pt';
      alert('Portuguese title (PT) is required.');
      return;
    }
    if (description.length < 50) {
      this.activeCreateLang = 'pt';
      alert('Portuguese description must be at least 50 characters.');
      return;
    }
    if (this.createPhotos.length === 0) {
      alert('Add at least one photo.');
      return;
    }
    this.onSaleTypeChange();
    this.previewLang = 'pt';
    this.showCreateConfirm = true;
  }

  backFromConfirm(): void {
    if (this.createSubmitting) return;
    this.showCreateConfirm = false;
  }

  async submitCreate(): Promise<void> {
    if (this.createSubmitting) return;
    const title = (this.createForm.title || '').trim();
    const description = (this.createForm.description || '').trim();
    const sellerEmail = (this.createForm.sellerEmail || '').trim();
    if (this.createPhotos.length === 0) {
      alert('Add at least one photo.');
      return;
    }
    this.onSaleTypeChange();

    this.createSubmitting = true;
    let images: string[];
    try {
      images = await this.uploadCreatePhotos();
    } catch (err: any) {
      this.createSubmitting = false;
      this.createUploadProgress = null;
      const blocked = err?.error?.error === 'Content policy violation';
      const message = err?.error?.message || err?.message || 'Could not upload the photos.';
      alert(
        blocked
          ? `Fail: a photo was blocked by the content-safety filter. Remove it and try again.\n${message}`
          : `Fail: ${message}`
      );
      return;
    }
    this.createUploadProgress = null;

    const payload: AdminCreateAuctionPayload = {
      ...this.createForm,
      sellerEmail,
      title,
      description,
      titleEn: (this.createForm.titleEn || '').trim() || undefined,
      titleEs: (this.createForm.titleEs || '').trim() || undefined,
      titleFr: (this.createForm.titleFr || '').trim() || undefined,
      descriptionEn: (this.createForm.descriptionEn || '').trim() || undefined,
      descriptionEs: (this.createForm.descriptionEs || '').trim() || undefined,
      descriptionFr: (this.createForm.descriptionFr || '').trim() || undefined,
      startingPrice: this.isGiveawayCreate ? 0 : Number(this.createForm.startingPrice) || 0,
      shippingCost: this.isGiveawayCreate ? 0 : Number(this.createForm.shippingCost) || 0,
      allowPrivateRoom: this.canAllowPrivateRoom ? !!this.createForm.allowPrivateRoom : false,
      images
    };

    this.adminService.createAuction(payload).subscribe({
      next: (res) => {
        this.createSubmitting = false;
        this.clearCreatePhotos();
        this.showCreateModal = false;
        this.showCreateConfirm = false;
        const kind = res.listing.saleFormat === 'giveaway' ? 'giveaway' : 'auction';
        const sellerNote = res.sellerCreated
          ? ` New seller account created for ${res.listing.seller.email}.`
          : '';
        alert(`Success: ${kind} "${res.listing.title}" created (${res.listing.status}).${sellerNote}`);
        this.page = 1;
        this.loadAuctions();
      },
      error: (err) => {
        this.createSubmitting = false;
        alert(`Fail: ${err?.error?.message || err?.message || 'Could not create listing.'}`);
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
