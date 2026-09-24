import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminBidder,
  AdminListingSocial,
  AdminListingText,
  AdminService,
  AdminSocialPlatform
} from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { PrivateRoomService } from '../../../private-room/services/private-room.service';
import { Listing } from '../../../shared/services/listings.service';

const NEXUS_CATEGORIES: { id: string; name: string; subCategories: string[] }[] = [
  {
    id: 'electronics',
    name: 'Electronics',
    subCategories: [
      'Laptops', 'Desktop Computers', 'Computer Components',
      'Smartphones', 'Tablets', 'Mobile Accessories',
      'Headphones', 'Speakers', 'Hi Fi Systems', 'Turntables',
      'Gaming Consoles', 'Video Games', 'Gaming Accessories',
      'Digital Cameras', 'Film Cameras', 'Camera Lenses', 'Camera Accessories',
      'Televisions', 'Projectors', 'Streaming Devices',
      'Smart Watches', 'Fitness Trackers', 'Wearables Accessories',
      'Other Electronics'
    ]
  },
  {
    id: 'home-garden',
    name: 'Home & Garden',
    subCategories: [
      'Tables', 'Chairs', 'Cabinets', 'Shelves', 'Beds',
      'Lamps', 'Mirrors', 'Vases', 'Wall Decor', 'Decorative Objects',
      'Cookware', 'Tableware', 'Glassware', 'Barware',
      'Garden Furniture', 'Garden Tools', 'Outdoor Decor', 'Planters',
      'Rugs', 'Curtains', 'Blankets', 'Cushions',
      'Lighting', 'Other Home & Garden'
    ]
  },
  {
    id: 'art',
    name: 'Art',
    subCategories: ['Paintings', 'Drawings', 'Prints', 'Photography', 'Sculptures', 'Figurines', 'Other Art']
  },
  {
    id: 'collectibles',
    name: 'Collectibles',
    subCategories: [
      'Definitive Stamps', 'Commemorative Stamps', 'Airmail Stamps',
      'Postage Due Stamps', 'Revenue / Fiscal Stamps', 'Official Stamps',
      'Military Mail', 'Local Issues', 'First Day Covers (FDC)',
      'Stamp Booklets', 'Collections / Lots',
      'Classic Stamps (Before 1900)', 'Early 20th Century (1900 to 1945)',
      'Post War (1945 to 1960)', 'Late 20th Century (1960 to 2000)',
      'Modern Stamps (2000 to Present)',
      'Coins & Banknotes', 'Trading Cards', 'Toys & Models',
      'Sports Memorabilia', 'Music Memorabilia', 'Movie Memorabilia',
      'Vintage Items', 'Other Collectibles'
    ]
  },
  {
    id: 'jewelry',
    name: 'Jewelry',
    subCategories: [
      'Engagement Rings', 'Wedding Rings', 'Fashion Rings',
      'Chains', 'Pendants',
      'Bangles', 'Charm Bracelets',
      'Stud Earrings', 'Hoop Earrings', 'Drop Earrings',
      'Luxury Watches', 'Vintage Watches', 'Smart Watches',
      'Brooches & Pins', 'Jewelry Sets', 'Loose Gemstones', 'Other Jewelry'
    ]
  },
  {
    id: 'vehicles',
    name: 'Vehicles',
    subCategories: [
      'Cars', 'Classic Cars', 'Electric & Hybrid Cars',
      'Motorcycles', 'Scooters & Mopeds',
      'Vans & Minibuses', 'Trucks & HGV',
      'Boats', 'Jet Skis & Watercraft', 'Sailboats',
      'Caravans & Motorhomes', 'ATVs & Quad Bikes',
      'Vehicle Parts', 'Vehicle Accessories', 'Other Vehicles'
    ]
  },
  {
    id: 'real-estate',
    name: 'Real Estate',
    subCategories: ['Apartments', 'Houses', 'Land', 'Commercial', 'Other Real Estate']
  }
];

const TEXT_LANGUAGES: { suffix: 'Pt' | 'En' | 'Fr' | 'Es'; label: string }[] = [
  { suffix: 'Pt', label: 'Português' },
  { suffix: 'En', label: 'English' },
  { suffix: 'Fr', label: 'Français' },
  { suffix: 'Es', label: 'Español' }
];

/** Mirrors the API: photos per listing, per upload, and per file. */
const MAX_LISTING_PHOTOS = 20;
const MAX_PHOTOS_PER_UPLOAD = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const SOCIAL_POLL_MS = 4000;

const isPlaceholderImage = (url: string) => /placeholder\.com/i.test(url);

function apiErrorMessage(err: any, fallback: string): string {
  return err?.error?.error || err?.error?.message || fallback;
}

@Component({
  selector: 'app-admin-auction-details',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-auction-details.component.html',
  styleUrls: ['./admin-auction-details.component.scss']
})
export class AdminAuctionDetailsComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private adminService = inject(AdminService);
  private privateRoomService = inject(PrivateRoomService);

  auctionId = '';
  auction: Listing | null = null;
  bidders: AdminBidder[] = [];
  isLoading = false;
  isCreatingPrivateRoom = false;
  isClosingPrivateRoom = false;
  isDeleting = false;
  isSavingCategory = false;
  error: string | null = null;
  showPlatinumSelection = false;
  selectedPlatinumBidders: string[] = [];

  readonly categories = NEXUS_CATEGORIES;
  editCategory = '';
  editSubCategory = '';
  categorySavedMsg: string | null = null;
  editEndDate = '';
  isSavingEndDate = false;
  endDateSavedMsg: string | null = null;

  // Photos: edits to order and removals stay local until saved.
  readonly maxListingPhotos = MAX_LISTING_PHOTOS;
  photoDraft: string[] = [];
  isSavingPhotos = false;
  isUploadingPhotos = false;
  photoError: string | null = null;
  photoSavedMsg: string | null = null;

  // Title and description per language.
  readonly textLanguages = TEXT_LANGUAGES;
  activeTextLanguage: 'Pt' | 'En' | 'Fr' | 'Es' = 'Pt';
  textDraft: AdminListingText = this.emptyText();
  isSavingText = false;
  textError: string | null = null;
  textSavedMsg: string | null = null;

  // Facebook / Instagram.
  readonly socialPlatforms: AdminSocialPlatform[] = ['facebook', 'instagram'];
  social: AdminListingSocial | null = null;
  socialError: string | null = null;
  publishingPlatform: AdminSocialPlatform | null = null;
  private socialPollTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  get editSubCategories(): string[] {
    return this.categories.find(c => c.id === this.editCategory)?.subCategories ?? [];
  }

  ngOnInit(): void {
    this.auctionId = this.route.snapshot.paramMap.get('id') || '';
    if (this.auctionId) {
      this.loadAuctionDetails();
      this.loadBidders();
      this.loadSocial();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopSocialPolling();
  }

  loadAuctionDetails(): void {
    this.isLoading = true;
    this.error = null;

    this.adminService.getAuctionById(this.auctionId).subscribe({
      next: (auction) => {
        this.auction = auction;
        this.editCategory = auction.category || 'jewelry';
        this.editSubCategory = auction.subCategory || '';
        this.editEndDate = this.toDatetimeLocal(auction.endDate);
        this.resetPhotoDraft();
        this.resetTextDraft();
        this.isLoading = false;
      },
      error: (error) => {
        this.error = error?.message || 'Failed to load auction details';
        this.isLoading = false;
      }
    });
  }

  onCategoryChange(): void {
    const subs = this.editSubCategories;
    if (!subs.includes(this.editSubCategory)) {
      this.editSubCategory = subs[0] || '';
    }
  }

  saveCategory(): void {
    if (!this.auction || !this.editCategory || !this.editSubCategory || this.isSavingCategory) return;
    this.isSavingCategory = true;
    this.categorySavedMsg = null;
    this.adminService.updateListingCategory(this.auctionId, {
      category: this.editCategory,
      subCategory: this.editSubCategory
    }).subscribe({
      next: (res) => {
        if (this.auction) {
          this.auction.category = res.category;
          this.auction.subCategory = res.subCategory;
        }
        this.isSavingCategory = false;
        this.categorySavedMsg = 'Category updated';
        setTimeout(() => { this.categorySavedMsg = null; }, 2500);
      },
      error: (err) => {
        this.isSavingCategory = false;
        alert(err?.error?.message || err?.error?.error || 'Failed to update category.');
      }
    });
  }

  private toDatetimeLocal(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  saveEndDate(): void {
    if (!this.auction || !this.editEndDate || this.isSavingEndDate) return;
    const newEnd = new Date(this.editEndDate);
    if (isNaN(newEnd.getTime())) { alert('Invalid date'); return; }
    this.isSavingEndDate = true;
    this.endDateSavedMsg = null;
    this.adminService.updateListingEndDate(this.auctionId, newEnd.toISOString()).subscribe({
      next: (res) => {
        if (this.auction) {
          (this.auction as any).endDate = res.endDate;
        }
        this.isSavingEndDate = false;
        this.endDateSavedMsg = 'End date updated';
        setTimeout(() => { this.endDateSavedMsg = null; }, 2500);
      },
      error: (err) => {
        this.isSavingEndDate = false;
        alert(err?.error?.message || err?.error?.error || 'Failed to update end date.');
      }
    });
  }

  loadBidders(): void {
    // Nexus reads its own endpoint: the seller-facing one carries no emails.
    this.adminService.getAuctionBidders(this.auctionId).subscribe({
      next: (response) => {
        this.bidders = response.bidders;
      },
      error: (error) => {
        console.error('Failed to load bidders:', error);
      }
    });
  }

  openPlatinumSelection(): void {
    // Filter to only authenticated bidders (required for platinum)
    const authenticatedBidders = this.bidders.filter(b => b.isAuthenticated && b._id);
    if (authenticatedBidders.length === 0) {
      alert('No authenticated bidders available. Only registered users can be selected.');
      return;
    }
    this.showPlatinumSelection = true;
    // Pre-select already selected platinum bidders
    if (this.auction?.platinumBidders) {
      this.selectedPlatinumBidders = this.auction.platinumBidders
        .map((pb: any) => typeof pb === 'string' ? pb : pb._id)
        .filter((id: string) => authenticatedBidders.some(b => b._id === id));
    }
  }

  closePlatinumSelection(): void {
    this.showPlatinumSelection = false;
    this.selectedPlatinumBidders = [];
  }

  togglePlatinumBidder(bidderId: string | null | undefined): void {
    if (!bidderId) return;
    
    const index = this.selectedPlatinumBidders.indexOf(bidderId);
    if (index > -1) {
      this.selectedPlatinumBidders.splice(index, 1);
    } else {
      if (this.selectedPlatinumBidders.length >= 5) {
        alert('You can select a maximum of 5 bidders.');
        return;
      }
      this.selectedPlatinumBidders.push(bidderId);
    }
  }

  isPlatinumSelected(bidderId: string | null | undefined): boolean {
    if (!bidderId) return false;
    return this.selectedPlatinumBidders.includes(bidderId);
  }

  createPrivateRoom(): void {
    if (!this.auction) return;

    if (this.selectedPlatinumBidders.length === 0) {
      alert('Please select at least one bidder to create a private room.');
      return;
    }

    this.isCreatingPrivateRoom = true;
    this.error = null;

    this.adminService.createPrivateRoom(this.auctionId, this.selectedPlatinumBidders).subscribe({
      next: () => {
        this.isCreatingPrivateRoom = false;
        this.showPlatinumSelection = false;
        this.selectedPlatinumBidders = [];
        this.loadAuctionDetails(); // Reload to get updated data
        this.loadBidders(); // Reload bidders to see updated status
      },
      error: (error) => {
        this.error = error?.message || 'Failed to create private auction room';
        this.isCreatingPrivateRoom = false;
      }
    });
  }

  getAuctionTypeLabel(format: string): string {
    return format === 'highest-bid' ? 'Highest Bid Auction' : 'Best Offer';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getBidderName(bidder: AdminBidder): string {
    if (bidder.isAuthenticated && bidder.firstName && bidder.lastName) {
      return `${bidder.firstName} ${bidder.lastName}`;
    }
    return bidder.email || 'Guest Bidder';
  }

  getAuthenticatedBidders(): AdminBidder[] {
    return this.bidders.filter(b => b.isAuthenticated && b._id);
  }

  isPlatinumBidder(bidderId: string | null | undefined): boolean {
    if (!bidderId || !this.auction?.platinumBidders) {
      return false;
    }
    // platinumBidders can be array of strings (IDs) or array of objects (populated)
    return this.auction.platinumBidders.some((pb: any) => {
      if (typeof pb === 'string') {
        return pb === bidderId;
      }
      return pb._id === bidderId || pb === bidderId;
    });
  }

  closePrivateRoomAndEndAuction(): void {
    if (!this.auction) return;

    if (!confirm('Are you sure you want to close the private room and end this auction? This action cannot be undone.')) {
      return;
    }

    this.isClosingPrivateRoom = true;
    this.error = null;

    this.adminService.closePrivateRoomAndEndAuction(this.auctionId).subscribe({
      next: () => {
        this.isClosingPrivateRoom = false;
        this.loadAuctionDetails(); // Reload to get updated data
        this.loadBidders(); // Reload bidders to see updated status
      },
      error: (error) => {
        this.error = error?.message || 'Failed to close private room and end auction';
        this.isClosingPrivateRoom = false;
      }
    });
  }

  bidderTrackKey(bidder: AdminBidder): string {
    return bidder._id != null ? String(bidder._id) : (bidder.email || String(bidder.lastBidDate));
  }

  deleteListing(): void {
    if (!this.auction || this.isDeleting) return;
    if (!confirm(`Delete "${this.auction.title}"? This permanently removes the listing and all its bids. Active transactions will block deletion.`)) return;
    this.isDeleting = true;
    this.adminService.deleteListing(this.auctionId).subscribe({
      next: () => {
        this.router.navigate(['/nexus/auctions']);
      },
      error: (err) => {
        this.isDeleting = false;
        alert(err?.error?.message || 'Failed to delete listing.');
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/nexus/auctions']);
  }

  // ── Photos ────────────────────────────────────────────────────────────

  /** The listing's real photos, without the "No Image" placeholder. */
  private get savedPhotos(): string[] {
    return (this.auction?.images ?? []).filter(url => !isPlaceholderImage(url));
  }

  get photosDirty(): boolean {
    return JSON.stringify(this.photoDraft) !== JSON.stringify(this.savedPhotos);
  }

  private resetPhotoDraft(): void {
    this.photoDraft = [...this.savedPhotos];
    this.photoError = null;
  }

  movePhoto(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.photoDraft.length) return;
    const next = [...this.photoDraft];
    [next[index], next[target]] = [next[target], next[index]];
    this.photoDraft = next;
  }

  makeCover(index: number): void {
    if (index <= 0) return;
    const next = [...this.photoDraft];
    const [photo] = next.splice(index, 1);
    this.photoDraft = [photo, ...next];
  }

  removePhoto(index: number): void {
    if (this.photoDraft.length <= 1) {
      this.photoError = 'A listing needs at least one photo. Add another one before removing this.';
      return;
    }
    this.photoDraft = this.photoDraft.filter((_, i) => i !== index);
  }

  discardPhotoChanges(): void {
    this.resetPhotoDraft();
  }

  savePhotos(): void {
    if (!this.auction || !this.photosDirty || this.isSavingPhotos) return;
    const removed = this.savedPhotos.filter(url => !this.photoDraft.includes(url)).length;
    if (removed > 0 && !confirm(
      `Remove ${removed} photo${removed === 1 ? '' : 's'} from this listing? ` +
      'Files not used by another listing or a completed sale are deleted permanently.'
    )) return;

    this.isSavingPhotos = true;
    this.photoError = null;
    this.adminService.setListingImages(this.auctionId, this.photoDraft, this.auction.images ?? []).subscribe({
      next: (res) => this.onPhotosSaved(res.images, 'Photos saved'),
      error: (err) => {
        this.isSavingPhotos = false;
        this.photoError = apiErrorMessage(err, 'Failed to save photos.');
        if (err?.error?.code === 'images_changed') this.reloadPhotos();
      }
    });
  }

  onPhotosSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0 || !this.auction) return;

    this.photoError = null;
    const tooBig = files.filter(f => f.size > MAX_PHOTO_BYTES).map(f => f.name);
    if (tooBig.length > 0) {
      this.photoError = `Each photo can be up to 10 MB: ${tooBig.join(', ')}.`;
      return;
    }
    if (files.length > MAX_PHOTOS_PER_UPLOAD) {
      this.photoError = `Add up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`;
      return;
    }
    if (this.savedPhotos.length + files.length > MAX_LISTING_PHOTOS) {
      this.photoError = `A listing can have up to ${MAX_LISTING_PHOTOS} photos (it has ${this.savedPhotos.length}).`;
      return;
    }

    this.isUploadingPhotos = true;
    this.adminService.addListingImages(this.auctionId, files).subscribe({
      next: (res) => {
        this.isUploadingPhotos = false;
        this.onPhotosSaved(res.images, `${files.length} photo${files.length === 1 ? '' : 's'} added`);
      },
      error: (err) => {
        this.isUploadingPhotos = false;
        this.photoError = apiErrorMessage(err, 'Failed to upload photos.');
      }
    });
  }

  private onPhotosSaved(images: string[], message: string): void {
    if (this.auction) this.auction.images = images;
    this.isSavingPhotos = false;
    this.resetPhotoDraft();
    this.flash(msg => this.photoSavedMsg = msg, message);
    this.loadSocial();
  }

  /** After a conflict: take the listing's current photos, keep the error visible. */
  private reloadPhotos(): void {
    const error = this.photoError;
    this.adminService.getAuctionById(this.auctionId).subscribe({
      next: (auction) => {
        if (this.auction) this.auction.images = auction.images;
        this.resetPhotoDraft();
        this.photoError = error;
      }
    });
  }

  // ── Title & description per language ─────────────────────────────────

  private emptyText(): AdminListingText {
    return {
      titlePt: '', titleEn: '', titleFr: '', titleEs: '',
      descriptionPt: '', descriptionEn: '', descriptionFr: '', descriptionEs: ''
    };
  }

  /** The listing's saved text, shaped like the form. */
  private savedText(): AdminListingText | null {
    const a = this.auction;
    if (!a) return null;
    // A listing from before per-language text only has title/description, which
    // is Portuguese. Once any language is set, title/description is just the
    // fallback and must not be copied into Portuguese.
    const hasLanguages = TEXT_LANGUAGES.some(l => a[`title${l.suffix}`] || a[`description${l.suffix}`]);
    return {
      titlePt: a.titlePt || (hasLanguages ? '' : a.title ?? ''),
      titleEn: a.titleEn ?? '',
      titleFr: a.titleFr ?? '',
      titleEs: a.titleEs ?? '',
      descriptionPt: a.descriptionPt || (hasLanguages ? '' : a.description ?? ''),
      descriptionEn: a.descriptionEn ?? '',
      descriptionFr: a.descriptionFr ?? '',
      descriptionEs: a.descriptionEs ?? ''
    };
  }

  private resetTextDraft(): void {
    this.textDraft = this.savedText() ?? this.emptyText();
    this.textError = null;
  }

  private titleField(suffix: string): keyof AdminListingText {
    return `title${suffix}` as keyof AdminListingText;
  }

  private descriptionField(suffix: string): keyof AdminListingText {
    return `description${suffix}` as keyof AdminListingText;
  }

  get activeTitle(): string {
    return this.textDraft[this.titleField(this.activeTextLanguage)] ?? '';
  }

  set activeTitle(value: string) {
    this.textDraft = { ...this.textDraft, [this.titleField(this.activeTextLanguage)]: value };
  }

  get activeDescription(): string {
    return this.textDraft[this.descriptionField(this.activeTextLanguage)] ?? '';
  }

  set activeDescription(value: string) {
    this.textDraft = { ...this.textDraft, [this.descriptionField(this.activeTextLanguage)]: value };
  }

  get textDirty(): boolean {
    const saved = this.savedText();
    return Boolean(saved) && JSON.stringify(saved) !== JSON.stringify(this.textDraft);
  }

  languageFilled(suffix: string): boolean {
    return Boolean(this.textDraft[this.titleField(suffix)]?.trim() || this.textDraft[this.descriptionField(suffix)]?.trim());
  }

  /** A language with only one of the two falls back to the main text for the other. */
  languageIncomplete(suffix: string): boolean {
    const title = this.textDraft[this.titleField(suffix)]?.trim();
    const description = this.textDraft[this.descriptionField(suffix)]?.trim();
    return Boolean(title) !== Boolean(description);
  }

  discardTextChanges(): void {
    this.resetTextDraft();
  }

  saveText(): void {
    if (!this.auction || this.isSavingText) return;
    this.isSavingText = true;
    this.textError = null;
    this.adminService.updateListingText(this.auctionId, this.textDraft).subscribe({
      next: ({ listing }) => {
        if (this.auction) Object.assign(this.auction, listing);
        this.isSavingText = false;
        this.resetTextDraft();
        this.flash(msg => this.textSavedMsg = msg, 'Text saved');
        this.loadSocial();
      },
      error: (err) => {
        this.isSavingText = false;
        this.textError = apiErrorMessage(err, 'Failed to save the text.');
      }
    });
  }

  // ── Facebook / Instagram ──────────────────────────────────────────────

  loadSocial(): void {
    this.stopSocialPolling();
    this.adminService.getListingSocial(this.auctionId).subscribe({
      next: (social) => {
        if (this.destroyed) return;
        this.social = social;
        this.socialError = null;
        const publishing = Object.values(social.platforms).some(p => p.state?.status === 'publishing');
        if (publishing) this.socialPollTimer = setTimeout(() => this.loadSocial(), SOCIAL_POLL_MS);
      },
      error: (err) => {
        this.socialError = apiErrorMessage(err, 'Failed to load social media state.');
      }
    });
  }

  private stopSocialPolling(): void {
    if (this.socialPollTimer) clearTimeout(this.socialPollTimer);
    this.socialPollTimer = null;
  }

  platformLabel(platform: AdminSocialPlatform): string {
    return platform === 'facebook' ? 'Facebook' : 'Instagram';
  }

  socialPostUrl(platform: AdminSocialPlatform): string | null {
    const state = this.social?.platforms[platform].state;
    if (!state?.postedAt) return null;
    if (platform === 'instagram') return state.permalink || null;
    return state.postId ? `https://www.facebook.com/${state.postId}` : null;
  }

  publishToSocial(platform: AdminSocialPlatform): void {
    const entry = this.social?.platforms[platform];
    if (!entry?.available || this.publishingPlatform) return;
    const label = this.platformLabel(platform);

    if (entry.state?.postedAt) {
      this.confirmRepost(platform);
      return;
    }
    if (!confirm(`Publish this listing to the BidRoom ${label} now? The post is public.`)) return;
    this.sendPublish(platform, false);
  }

  private confirmRepost(platform: AdminSocialPlatform): void {
    const state = this.social?.platforms[platform].state;
    const when = state?.postedAt ? ` on ${this.formatDate(state.postedAt)}` : '';
    if (!confirm(
      `This listing was already published to ${this.platformLabel(platform)}${when}. ` +
      'Publish it again? Followers will see a second post.'
    )) return;
    this.sendPublish(platform, true);
  }

  private sendPublish(platform: AdminSocialPlatform, repost: boolean): void {
    this.publishingPlatform = platform;
    this.socialError = null;
    this.adminService.publishListingToSocial(this.auctionId, platform, repost).subscribe({
      next: () => {
        this.publishingPlatform = null;
        this.loadSocial();
      },
      error: (err) => {
        this.publishingPlatform = null;
        if (err?.error?.code === 'already_posted' && !repost) {
          // Someone else published it meanwhile.
          this.loadSocial();
          this.confirmRepost(platform);
          return;
        }
        this.socialError = apiErrorMessage(err, `Failed to publish to ${this.platformLabel(platform)}.`);
        this.loadSocial();
      }
    });
  }

  private flash(set: (msg: string | null) => void, message: string): void {
    set(message);
    setTimeout(() => set(null), 2500);
  }
}

