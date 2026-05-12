import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, from, merge, Subject, Subscription } from 'rxjs';
import { debounceTime, filter, switchMap, tap } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ListingsService } from '../../../shared/services/listings.service';
import { CustomerService, CustomerInfo } from '../../../shared/services/customer.service';
import { KycService, KYC_THRESHOLD } from '../../../shared/services/kyc.service';
import { API_CONFIG } from '../../../shared/config/api.config';
import { environment } from '@env';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

interface Category {
  id: string;
  name: string;
  subCategories: string[];
}

@Component({
  selector: 'app-add-listing',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './add-listing.html',
  styleUrl: './add-listing.scss',
})
export class AddListing implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private listingsService = inject(ListingsService);
  private customerService = inject(CustomerService);
  private http = inject(HttpClient);
  private translate = inject(TranslateService);
  private kycService = inject(KycService);

  listingForm!: FormGroup;
  isSubmitting = false;
  errorMessage = '';
  isUploadingImages = false;
  isLoadingCustomer = true;
  isStripeConnected = false;
  customerLoadError = false;

  uploadedFiles: File[] = [];
  uploadedFileUrls: string[] = [];
  previewUrls: (string | ArrayBuffer | null)[] = [];

  // Drag-to-reorder state
  dragSrcIndex: number | null = null;
  dragOverIndex: number | null = null;

  /** Autosave draft */
  private readonly mediaChange$ = new Subject<void>();
  private draftAutosaveSub?: Subscription;
  private restoringDraft = false;
  /** Maps stable file fingerprint → uploaded image URL (avoids re-uploading on each autosave). */
  private readonly urlByFileKey = new Map<string, string>();
  draftSaveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  draftSaveError = '';

  // Categories
  categories: Category[] = [
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
      subCategories: [
        'Paintings', 'Drawings', 'Prints', 'Photography',
        'Sculptures', 'Figurines',
        'Other Art'
      ]
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
    }
  ];

  itemConditions = [
    { value: 'New', labelKey: 'addListing.conditionNew' },
    { value: 'Used - Excellent', labelKey: 'addListing.conditionUsedExcellent' },
    { value: 'Used - Very Good', labelKey: 'addListing.conditionUsedVeryGood' },
    { value: 'Used - Good', labelKey: 'addListing.conditionUsedGood' },
    { value: 'Used - Fair', labelKey: 'addListing.conditionUsedFair' },
    { value: 'For Parts or Not Working', labelKey: 'addListing.conditionForParts' }
  ];

  listingDurations = environment.auctionDurations.map((d: { label: string; hours: number }) => ({
    ...d,
    labelKey: d.hours <= 1/12 ? 'addListing.duration5min' :
      d.hours <= 1 ? 'addListing.duration1hour' :
      d.hours <= 7 ? 'addListing.duration7hours' : 'addListing.duration24hours'
  }));

  shippingOptions = [
    { value: 'flat-rate', labelKey: 'addListing.shippingFlatRate' },
    { value: 'calculated', labelKey: 'addListing.shippingCalculated' },
    { value: 'local-pickup', labelKey: 'addListing.shippingLocalPickup' },
    { value: 'free', labelKey: 'addListing.shippingFree' }
  ];

  returnPolicies = [
    { value: '30-days', labelKey: 'addListing.return30' },
    { value: '14-days', labelKey: 'addListing.return14' },
    { value: 'no-returns', labelKey: 'addListing.returnNo' },
    { value: 'custom', labelKey: 'addListing.returnCustom' }
  ];

  selectedCategory: Category | null = null;
  /** Seller commission % for display (3.5 standard, 6.0 for private room). Base from environment. */
  commissionRate = 3.5;

  /** Buyer fee % for display (from environment) */
  get buyerFeeRatePct(): number {
    const rate = (environment as { bidroomFeeBuyerRate?: number }).bidroomFeeBuyerRate;
    return rate != null ? rate * 100 : 0;
  }

  /** Whether all required fields are valid and media is present */
  get canPublish(): boolean {
    return this.listingForm.valid && this.isMediaValid && this.uploadedFiles.length >= 1 && !this.isSubmitting && !this.isUploadingImages;
  }

  ngOnInit(): void {
    this.initializeForm();
    this.setupFormSubscriptions();
    void this.loadDraftFromServer();
    this.setupDraftAutosave();
    this.loadCustomerInfo();
  }

  ngOnDestroy(): void {
    this.draftAutosaveSub?.unsubscribe();
    this.mediaChange$.complete();
  }

  loadCustomerInfo(): void {
    this.customerService.getCustomer().subscribe({
      next: (info: CustomerInfo) => {
        this.isStripeConnected = info.stripeConnectOnboarded;
        this.isLoadingCustomer = false;
      },
      error: () => {
        this.isLoadingCustomer = false;
        this.customerLoadError = true;
      }
    });
  }

  initializeForm(): void {
    this.listingForm = this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(80)]],
      category: ['', Validators.required],
      subCategory: ['', Validators.required],
      listingFormat: ['auction', Validators.required],
      itemMode: ['single', Validators.required],
      quantity: [null],
      condition: ['', Validators.required],
      description: ['', [Validators.required, Validators.minLength(50)]],
      media: this.fb.array([]),
      specifications: this.fb.array([]),
      bundleItems: this.fb.array([]),
      locationCity: ['', Validators.required],
      locationRegion: ['', Validators.required],
      locationCountry: ['US', Validators.required],
      duration: ['', Validators.required],
      startingBid: [null],
      reservePrice: [null],
      buyNowPrice: [null],
      minimumAcceptPrice: [null],
      allowPrivateRoom: [false, Validators.required],
      shippingOption: ['', Validators.required],
      flatRateShipping: [null],
      packageSize: [''],
      shippingOriginPostalCode: [''],
      shippingOriginCity: [''],
      shippingOriginCountry: ['US'],
      returnPolicy: ['', Validators.required],
      sellerDeclaration: [false, Validators.requiredTrue]
    });

    // Conditional validators based on listing format
    this.listingForm.get('listingFormat')?.valueChanges.subscribe(format => {
      this.updateConditionalValidators(format);
      if (format === 'best-offer') {
        this.listingForm.patchValue({ allowPrivateRoom: false });
        this.commissionRate = 0.5;
      }
    });
    this.updateConditionalValidators(this.listingForm.get('listingFormat')?.value || 'auction');

    // itemMode validators
    this.listingForm.get('itemMode')?.valueChanges.subscribe(mode => {
      const qtyControl = this.listingForm.get('quantity');
      if (mode === 'multi_quantity') {
        qtyControl?.setValidators([Validators.required, Validators.min(2), Validators.max(999)]);
      } else {
        qtyControl?.clearValidators();
        qtyControl?.setValue(null);
      }
      qtyControl?.updateValueAndValidity();
      if (mode !== 'bundle') {
        while (this.bundleItems.length) this.bundleItems.removeAt(0);
      }
    });

    // Conditional validators for shipping option
    this.listingForm.get('shippingOption')?.valueChanges.subscribe(option => {
      const flatRateControl      = this.listingForm.get('flatRateShipping');
      const packageSizeControl   = this.listingForm.get('packageSize');
      const postalCodeControl    = this.listingForm.get('shippingOriginPostalCode');

      if (option === 'flat-rate') {
        flatRateControl?.setValidators([Validators.required, Validators.min(0)]);
        packageSizeControl?.clearValidators();
        postalCodeControl?.clearValidators();
      } else if (option === 'calculated') {
        flatRateControl?.clearValidators();
        packageSizeControl?.setValidators([Validators.required]);
        postalCodeControl?.setValidators([Validators.required]);
      } else {
        flatRateControl?.clearValidators();
        packageSizeControl?.clearValidators();
        postalCodeControl?.clearValidators();
      }
      flatRateControl?.updateValueAndValidity();
      packageSizeControl?.updateValueAndValidity();
      postalCodeControl?.updateValueAndValidity();
    });

    // Watch Private Room toggle for commission calculation
    const baseRatePct = ((environment as { bidroomFeeSellerRate?: number }).bidroomFeeSellerRate ?? 0.005) * 100;
    this.listingForm.get('allowPrivateRoom')?.valueChanges.subscribe(enabled => {
      this.commissionRate = enabled ? 6.0 : baseRatePct;
    });
    this.commissionRate = this.listingForm.get('allowPrivateRoom')?.value ? 6.0 : baseRatePct;
  }

  setupFormSubscriptions(): void {
    this.listingForm.get('category')?.valueChanges.subscribe(categoryId => {
      this.selectedCategory = this.categories.find(c => c.id === categoryId) || null;
      this.listingForm.patchValue({ subCategory: '' });
    });
  }

  private fileKey(file: File): string {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }

  private notifyMediaChanged(): void {
    this.mediaChange$.next();
  }

  private setupDraftAutosave(): void {
    this.draftAutosaveSub = merge(this.listingForm.valueChanges, this.mediaChange$).pipe(
      tap(() => {
        if (this.draftSaveStatus === 'saved') this.draftSaveStatus = 'idle';
      }),
      debounceTime(2800),
      filter(() => !this.restoringDraft && !this.isSubmitting && !this.isUploadingImages),
      switchMap(() => from(this.persistDraft({ manual: false })))
    ).subscribe({
      error: () => {
        this.draftSaveStatus = 'error';
        this.draftSaveError = this.translate.instant('addListing.draftError');
      }
    });
  }

  private hasDraftableContent(): boolean {
    const v = this.listingForm.getRawValue() as Record<string, unknown>;
    const text = (s: unknown) => (typeof s === 'string' ? s.trim() : '');
    if (text(v['title'])) return true;
    if (text(v['description'])) return true;
    if (text(v['category'])) return true;
    if (text(v['subCategory'])) return true;
    if (v['startingBid'] != null && v['startingBid'] !== '') return true;
    if (v['minimumAcceptPrice'] != null && v['minimumAcceptPrice'] !== '') return true;
    if (this.uploadedFiles.length > 0) return true;
    if ([...this.urlByFileKey.values()].length > 0) return true;
    return false;
  }

  private buildDraftPayload(): Record<string, unknown> {
    const formValue = this.listingForm.getRawValue();
    const imageUrls = this.buildOrderedImageUrlList();
    return { ...formValue, imageUrls };
  }

  /** Ordered URLs for image files only (videos are not stored in draft). */
  private buildOrderedImageUrlList(): string[] {
    const urls: string[] = [];
    for (const file of this.uploadedFiles) {
      if (this.ALLOWED_IMAGE_TYPES.includes(file.type)) {
        const u = this.urlByFileKey.get(this.fileKey(file));
        if (u) urls.push(u);
      }
    }
    return urls;
  }

  private async uploadPendingImagesForDraft(): Promise<void> {
    const pending = this.uploadedFiles.filter(
      f => this.ALLOWED_IMAGE_TYPES.includes(f.type) && !this.urlByFileKey.has(this.fileKey(f))
    );
    if (pending.length === 0) return;

    const chunkSize = 10;
    for (let i = 0; i < pending.length; i += chunkSize) {
      const chunk = pending.slice(i, i + chunkSize);
      const formData = new FormData();
      chunk.forEach(file => formData.append('images', file));
      const response = await firstValueFrom(
        this.http.post<{ urls: string[] }>(`${API_CONFIG.getApiUrl()}/uploads`, formData)
      );
      const urls = response.urls || [];
      chunk.forEach((file, idx) => {
        const url = urls[idx];
        if (url) this.urlByFileKey.set(this.fileKey(file), url);
      });
    }
  }

  private async persistDraft(opts: { manual: boolean }): Promise<void> {
    if (!this.hasDraftableContent()) {
      if (opts.manual) {
        this.draftSaveStatus = 'idle';
        this.draftSaveError = '';
      }
      return;
    }
    this.draftSaveStatus = 'saving';
    this.draftSaveError = '';
    const pendingUpload = this.uploadedFiles.some(
      f => this.ALLOWED_IMAGE_TYPES.includes(f.type) && !this.urlByFileKey.has(this.fileKey(f))
    );
    if (pendingUpload) this.isUploadingImages = true;
    try {
      await this.uploadPendingImagesForDraft();
      const payload = this.buildDraftPayload();
      await firstValueFrom(this.listingsService.saveListingDraft(payload));
      this.draftSaveStatus = 'saved';
      if (opts.manual) {
        void Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: this.translate.instant('addListing.draftSaved'),
          showConfirmButton: false,
          timer: 2200,
          timerProgressBar: true
        });
      }
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 401) {
        this.draftSaveStatus = 'idle';
        return;
      }
      this.draftSaveStatus = 'error';
      this.draftSaveError = this.translate.instant('addListing.draftError');
      if (opts.manual) {
        this.errorMessage = this.draftSaveError;
      }
    } finally {
      if (pendingUpload) this.isUploadingImages = false;
    }
  }

  async saveDraftManually(): Promise<void> {
    if (this.isSubmitting || this.isUploadingImages) return;
    await this.persistDraft({ manual: true });
  }

  private async loadDraftFromServer(): Promise<void> {
    try {
      const res = await firstValueFrom(this.listingsService.getListingDraft());
      const draft = res?.draft;
      if (!draft?.payload || typeof draft.payload !== 'object') return;

      this.restoringDraft = true;
      const p = draft.payload as Record<string, unknown>;

      const patch: Record<string, unknown> = {};
      const keys = [
        'title', 'category', 'subCategory', 'listingFormat', 'itemMode', 'quantity', 'condition', 'description',
        'locationCity', 'locationRegion', 'locationCountry', 'duration', 'startingBid',
        'reservePrice', 'buyNowPrice', 'minimumAcceptPrice', 'allowPrivateRoom',
        'shippingOption', 'flatRateShipping', 'packageSize', 'shippingOriginPostalCode',
        'shippingOriginCity', 'shippingOriginCountry', 'returnPolicy', 'sellerDeclaration'
      ];
      for (const k of keys) {
        if (k in p && p[k] !== undefined) patch[k] = p[k];
      }
      this.listingForm.patchValue(patch, { emitEvent: false });

      const catId = patch['category'] as string;
      this.selectedCategory = catId ? this.categories.find(c => c.id === catId) || null : null;

      const specs = p['specifications'];
      if (Array.isArray(specs)) {
        while (this.specifications.length) this.specifications.removeAt(0);
        for (const row of specs) {
          const r = row as { key?: string; value?: string };
          this.specifications.push(
            this.fb.group({
              key: [r.key || '', Validators.required],
              value: [r.value || '', Validators.required]
            })
          );
        }
      }

      const bundleItemsData = p['bundleItems'];
      if (Array.isArray(bundleItemsData)) {
        while (this.bundleItems.length) this.bundleItems.removeAt(0);
        for (const item of bundleItemsData) {
          const it = item as { title?: string; description?: string };
          this.bundleItems.push(this.fb.group({
            title: [it.title || '', [Validators.required, Validators.maxLength(100)]],
            description: [it.description || '', Validators.maxLength(500)]
          }));
        }
      }

      const format = (patch['listingFormat'] as string) || this.listingForm.get('listingFormat')?.value;
      this.updateConditionalValidators(format || 'auction');

      const urls = p['imageUrls'];
      if (Array.isArray(urls) && urls.length > 0) {
        await this.hydrateMediaFromUrls(urls.filter((u): u is string => typeof u === 'string' && u.length > 0));
      }

      this.restoringDraft = false;
      void Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'info',
        title: this.translate.instant('addListing.draftRestored'),
        showConfirmButton: false,
        timer: 3500,
        timerProgressBar: true
      });
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 401) {
        this.restoringDraft = false;
        return;
      }
      this.restoringDraft = false;
    }
  }

  private async hydrateMediaFromUrls(urls: string[]): Promise<void> {
    this.uploadedFiles = [];
    this.previewUrls = [];
    while (this.media.length) this.media.removeAt(0);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) continue;
        const blob = await res.blob();
        const ext = blob.type?.split('/')[1] || 'jpg';
        const file = new File([blob], `draft-${i}.${ext}`, { type: blob.type || 'image/jpeg' });
        this.urlByFileKey.set(this.fileKey(file), url);
        this.uploadedFiles.push(file);
        this.previewUrls.push(URL.createObjectURL(blob));
        this.media.push(this.fb.control(file));
      } catch {
        /* skip broken image */
      }
    }
  }

  updateConditionalValidators(format: string): void {
    const startingBidControl = this.listingForm.get('startingBid');
    const reservePriceControl = this.listingForm.get('reservePrice');
    const buyNowPriceControl = this.listingForm.get('buyNowPrice');
    const minimumAcceptPriceControl = this.listingForm.get('minimumAcceptPrice');

    if (format === 'auction') {
      startingBidControl?.setValidators([Validators.required, Validators.min(0.01)]);
      reservePriceControl?.clearValidators();
      reservePriceControl?.setValue(null);
      buyNowPriceControl?.setValidators([]);
      minimumAcceptPriceControl?.clearValidators();

      buyNowPriceControl?.valueChanges.subscribe(value => {
        if (value && startingBidControl?.value && value <= startingBidControl.value) {
          buyNowPriceControl.setErrors({ mustBeHigherThanStartingBid: true });
        }
      });
    } else if (format === 'best-offer') {
      startingBidControl?.clearValidators();
      reservePriceControl?.clearValidators();
      buyNowPriceControl?.clearValidators();
      minimumAcceptPriceControl?.setValidators([]);
    }

    startingBidControl?.updateValueAndValidity();
    reservePriceControl?.updateValueAndValidity();
    buyNowPriceControl?.updateValueAndValidity();
    minimumAcceptPriceControl?.updateValueAndValidity();
  }

  get specifications(): FormArray {
    return this.listingForm.get('specifications') as FormArray;
  }

  get media(): FormArray {
    return this.listingForm.get('media') as FormArray;
  }

  get bundleItems(): FormArray {
    return this.listingForm.get('bundleItems') as FormArray;
  }

  addBundleItem(): void {
    this.bundleItems.push(this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(100)]],
      description: ['', Validators.maxLength(500)]
    }));
  }

  removeBundleItem(index: number): void {
    this.bundleItems.removeAt(index);
  }

  getSelectedSubCategories(): string[] {
    return this.selectedCategory?.subCategories || [];
  }

  addSpecification(): void {
    const specGroup = this.fb.group({
      key: ['', Validators.required],
      value: ['', Validators.required]
    });
    this.specifications.push(specGroup);
  }

  removeSpecification(index: number): void {
    this.specifications.removeAt(index);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.addFiles(input.files);
      input.value = '';
    }
  }

  onFilesDropped(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.addFiles(files);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private readonly ALLOWED_IMAGE_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'
  ];

  private readonly ALLOWED_VIDEO_TYPES = [
    'video/mp4', 'video/webm', 'video/quicktime'
  ];

  get imageCount(): number {
    return this.uploadedFiles.filter(f => this.ALLOWED_IMAGE_TYPES.includes(f.type)).length;
  }

  get videoCount(): number {
    return this.uploadedFiles.filter(f => this.ALLOWED_VIDEO_TYPES.includes(f.type)).length;
  }

  isVideoFile(file: File): boolean {
    return this.ALLOWED_VIDEO_TYPES.includes(file.type);
  }

  get isMediaValid(): boolean {
    const imgs = this.imageCount;
    const vids = this.videoCount;
    if (vids === 0) return imgs >= 1 && imgs <= 20;
    if (vids === 1) return imgs >= 1 && imgs <= 5;
    return false;
  }

  private addFiles(fileList: FileList | File[]): void {
    this.errorMessage = '';
    const files = Array.from(fileList);
    const countBefore = this.uploadedFiles.length;
    const rejected: { name: string; reason: 'type' | 'maxPhotos' | 'maxPhotosWithVideo' | 'videoLimit' }[] = [];
    let imgs = this.imageCount;
    let vids = this.videoCount;

    files.forEach(file => {
      const isImage = this.ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVideo = this.ALLOWED_VIDEO_TYPES.includes(file.type);

      if (isImage) {
        if (vids >= 1 && imgs >= 5) {
          rejected.push({ name: file.name, reason: 'maxPhotosWithVideo' });
          return;
        }
        if (vids === 0 && imgs >= 20) {
          rejected.push({ name: file.name, reason: 'maxPhotos' });
          return;
        }
        this.uploadedFiles.push(file);
        imgs++;
        const reader = new FileReader();
        reader.onload = (e) => { this.previewUrls.push(e.target?.result || null); };
        reader.readAsDataURL(file);
      } else if (isVideo) {
        if (vids >= 1 || imgs >= 5) {
          rejected.push({ name: file.name, reason: 'videoLimit' });
          return;
        }
        this.uploadedFiles.push(file);
        this.previewUrls.push(null);
        vids++;
      } else {
        rejected.push({ name: file.name, reason: 'type' });
      }
    });

    if (this.uploadedFiles.length > countBefore) {
      this.notifyMediaChanged();
    }

    if (rejected.length > 0) {
      const byReason = new Map<typeof rejected[number]['reason'], string[]>();
      for (const r of rejected) {
        const list = byReason.get(r.reason) ?? [];
        list.push(r.name);
        byReason.set(r.reason, list);
      }
      const parts: string[] = [];
      const joinFiles = (names: string[]) => names.join(', ');
      if (byReason.has('type')) {
        parts.push(this.translate.instant('addListing.errors.invalidFileType', { files: joinFiles(byReason.get('type')!) }));
      }
      if (byReason.has('maxPhotos')) {
        parts.push(this.translate.instant('addListing.errors.mediaMaxPhotos', { files: joinFiles(byReason.get('maxPhotos')!) }));
      }
      if (byReason.has('maxPhotosWithVideo')) {
        parts.push(this.translate.instant('addListing.errors.mediaMaxPhotosWithVideo', { files: joinFiles(byReason.get('maxPhotosWithVideo')!) }));
      }
      if (byReason.has('videoLimit')) {
        parts.push(this.translate.instant('addListing.errors.mediaVideoLimit', { files: joinFiles(byReason.get('videoLimit')!) }));
      }
      this.errorMessage = parts.join(' ');
    }
    while (this.media.length < this.uploadedFiles.length) {
      this.media.push(this.fb.control(this.uploadedFiles[this.media.length]));
    }
  }

  removeFile(index: number): void {
    if (index >= 0 && index < this.uploadedFiles.length) {
      const prev = this.previewUrls[index];
      if (typeof prev === 'string' && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      this.uploadedFiles.splice(index, 1);
      this.previewUrls.splice(index, 1);
      if (this.media.length > index) {
        this.media.removeAt(index);
      }
      this.notifyMediaChanged();
    }
  }

  // ─── Drag-to-reorder ───────────────────────────────────────────────────────

  onThumbDragStart(index: number, event: DragEvent): void {
    this.dragSrcIndex = index;
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('text/plain', String(index));
  }

  onThumbDragOver(index: number, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation(); // Don't let the outer file-drop zone handle this
    event.dataTransfer!.dropEffect = 'move';
    this.dragOverIndex = index;
  }

  onThumbDragLeave(): void {
    this.dragOverIndex = null;
  }

  onThumbDrop(index: number, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const src = this.dragSrcIndex;
    this.dragSrcIndex = null;
    this.dragOverIndex = null;

    if (src === null || src === index) return;

    const files = [...this.uploadedFiles];
    const previews = [...this.previewUrls];

    const [movedFile] = files.splice(src, 1);
    const [movedPreview] = previews.splice(src, 1);
    files.splice(index, 0, movedFile);
    previews.splice(index, 0, movedPreview);

    this.uploadedFiles = files;
    this.previewUrls = previews;
    this.notifyMediaChanged();
  }

  onThumbDragEnd(): void {
    this.dragSrcIndex = null;
    this.dragOverIndex = null;
  }

  /** Seller commission (BidRoom fee). */
  calculateEstimatedCommission(): number {
    const startingBid = this.listingForm.get('startingBid')?.value || 0;
    const buyNowPrice = this.listingForm.get('buyNowPrice')?.value || 0;
    const minimumAcceptPrice = this.listingForm.get('minimumAcceptPrice')?.value || 0;
    const priceBasis = Math.max(startingBid, buyNowPrice, minimumAcceptPrice);
    const sellerRate = (environment as { bidroomFeeSellerRate?: number }).bidroomFeeSellerRate;
    const rate = sellerRate != null ? (this.listingForm.get('allowPrivateRoom')?.value ? 0.06 : sellerRate) : (this.commissionRate / 100);
    return priceBasis * rate;
  }

  calculateEstimatedFees(): { commission: number; paymentProcessing: number; buyerFee: number; total: number } {
    const priceBasis = this.listingForm.get('startingBid')?.value ||
                      this.listingForm.get('buyNowPrice')?.value ||
                      this.listingForm.get('minimumAcceptPrice')?.value || 0;
    const envSeller = (environment as { bidroomFeeSellerRate?: number }).bidroomFeeSellerRate;
    const envBuyer = (environment as { bidroomFeeBuyerRate?: number }).bidroomFeeBuyerRate;
    const sellerRate = envSeller != null ? (this.listingForm.get('allowPrivateRoom')?.value ? 0.06 : envSeller) : (this.commissionRate / 100);
    const buyerRate = envBuyer ?? 0;
    const commission = priceBasis * sellerRate;
    const buyerFee = priceBasis * buyerRate;
    const paymentProcessing = priceBasis * 0.029 + 0.30;
    return { commission, paymentProcessing, buyerFee, total: commission + paymentProcessing };
  }

  async uploadImages(): Promise<string[]> {
    if (this.uploadedFiles.length === 0) return [];
    this.isUploadingImages = true;
    try {
      const formData = new FormData();
      this.uploadedFiles.forEach(file => formData.append('images', file));
      const response = await firstValueFrom(
        this.http.post<{ urls: string[]; count: number }>(`${API_CONFIG.getApiUrl()}/uploads`, formData)
      );
      this.uploadedFileUrls = response.urls || [];
      this.isUploadingImages = false;
      return this.uploadedFileUrls;
    } catch (error: any) {
      this.isUploadingImages = false;
      throw new Error(error.error?.message || 'Failed to upload images. Please try again.');
    }
  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting || this.isUploadingImages) return;

    // Mark all fields touched so validation styles appear
    Object.keys(this.listingForm.controls).forEach(key => {
      this.listingForm.get(key)?.markAsTouched();
    });

    if (!this.listingForm.valid || this.uploadedFiles.length < 1 || !this.isMediaValid) {
      const fieldLabels: Record<string, string> = {
        title: 'Listing Title',
        category: 'Category',
        subCategory: 'Sub-Category',
        condition: 'Item Condition',
        description: 'Full Description (min. 50 characters)',
        startingBid: 'Starting Bid',
        locationCity: 'City',
        locationRegion: 'Region / State',
        duration: 'Listing Duration',
        shippingOption: 'Shipping Option',
        returnPolicy: 'Return Policy',
        sellerDeclaration: 'Seller Declaration checkbox',
      };

      const missing: string[] = [];
      if (this.uploadedFiles.length < 1) missing.push('at least 1 photo');
      Object.keys(fieldLabels).forEach(key => {
        if (this.listingForm.get(key)?.invalid) missing.push(fieldLabels[key]);
      });

      this.errorMessage = missing.length > 0
        ? `Please complete the following before publishing: ${missing.join(', ')}.`
        : 'Please fix the highlighted errors before publishing.';

      setTimeout(() => {
        const firstInvalid = document.querySelector('.ng-invalid:not(form):not(ng-component)');
        firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }

    // Pre-flight KYC check for high-value listings
    const price = parseFloat(this.listingForm.get('startingBid')?.value || '0');
    if (price >= KYC_THRESHOLD) {
      const status = await firstValueFrom(this.kycService.fetchStatus()).catch(() => null);
      if (status?.kycStatus !== 'approved') {
        this.kycService.openKycGate(status?.kycStatus ?? 'none');
        return;
      }
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      this.errorMessage = this.translate.instant('addListing.uploadingImages');
      const imageUrls = await this.uploadImages();
      if (imageUrls.length === 0) {
        throw new Error(this.translate.instant('addListing.errorUploadFailed'));
      }

      this.errorMessage = this.translate.instant('addListing.creatingListing');
      const formData = this.prepareListingData();
      formData.images = imageUrls;

      const listing = await firstValueFrom(this.listingsService.createListing(formData));

      this.isSubmitting = false;
      this.errorMessage = '';
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: this.translate.instant('addListing.successMessage'),
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true
      });
      this.router.navigate(['/listing', listing.slug]);
      firstValueFrom(this.listingsService.deleteListingDraft()).catch(() => {});
    } catch (error: any) {
      this.isSubmitting = false;
      if (error?.error?.error === 'kyc_required') {
        this.kycService.openKycGate(error.error.kycStatus || 'none');
        return;
      }
      this.errorMessage = error.message || error.error?.message || 'Failed to create listing. Please try again.';
    }
  }

  prepareListingData(): any {
    const formValue = this.listingForm.value;
    return {
      title: formValue.title,
      description: formValue.description,
      category: formValue.category,
      subCategory: formValue.subCategory,
      condition: formValue.condition,
      listingFormat: formValue.listingFormat,
      duration: formValue.duration,
      startingPrice: formValue.startingBid || null,
      reservePrice: formValue.listingFormat === 'auction' ? null : (formValue.reservePrice || null),
      buyNowPrice: formValue.buyNowPrice || null,
      minimumOfferPrice: formValue.minimumAcceptPrice || null,
      allowPrivateRoom: formValue.allowPrivateRoom,
      commissionRate: this.commissionRate,
      locationCity: formValue.locationCity?.trim(),
      locationCountry: formValue.locationCountry,
      location: `${formValue.locationCity}, ${formValue.locationRegion}, ${formValue.locationCountry}`,
      shippingCost: formValue.flatRateShipping || (formValue.shippingOption === 'free' ? 0 : null),
      shippingOption: formValue.shippingOption,
      packageSize: formValue.shippingOption === 'calculated' ? formValue.packageSize : null,
      shippingOriginPostalCode: formValue.shippingOption === 'calculated' ? formValue.shippingOriginPostalCode : null,
      shippingOriginCity: formValue.shippingOption === 'calculated' ? formValue.shippingOriginCity : null,
      shippingOriginCountry: formValue.shippingOption === 'calculated' ? (formValue.shippingOriginCountry || 'US') : null,
      returnPolicy: formValue.returnPolicy,
      specifications: formValue.specifications || [],
      itemMode: formValue.itemMode || 'single',
      quantity: formValue.itemMode === 'multi_quantity' ? (formValue.quantity || 2) : 1,
      bundleItems: formValue.itemMode === 'bundle' ? (formValue.bundleItems || []) : [],
      images: this.uploadedFileUrls
    };
  }

  getFieldError(fieldName: string): string {
    const control = this.listingForm.get(fieldName);
    if (control && control.invalid && control.touched) {
      if (control.hasError('required')) {
        return this.translate.instant('addListing.errors.required', { field: this.getFieldLabel(fieldName) });
      }
      if (control.hasError('maxLength')) {
        return this.translate.instant('addListing.errors.tooLong', { field: this.getFieldLabel(fieldName) });
      }
      if (control.hasError('minLength')) {
        return this.translate.instant('addListing.errors.tooShort', { field: this.getFieldLabel(fieldName) });
      }
      if (control.hasError('min')) {
        return this.translate.instant('addListing.errors.minValue', { min: control.errors?.['min'].min });
      }
      if (control.hasError('mustBeHigherThanStartingBid')) {
        return this.translate.instant('addListing.errors.buyNowTooLow');
      }
      if (control.hasError('mustBeAtLeastStartingBid')) {
        return this.translate.instant('addListing.errors.reserveTooLow');
      }
    }
    return '';
  }

  getFieldLabel(fieldName: string): string {
    const keyMap: Record<string, string> = {
      title: 'addListing.listingTitle',
      category: 'addListing.category',
      subCategory: 'addListing.subCategory',
      listingFormat: 'addListing.listingFormat',
      condition: 'addListing.condition',
      description: 'addListing.description',
      locationCity: 'addListing.city',
      locationRegion: 'addListing.regionState',
      locationCountry: 'addListing.originCountry',
      duration: 'addListing.duration',
      startingBid: 'addListing.startingBid',
      reservePrice: 'addListing.reservePrice',
      shippingOption: 'addListing.shippingOptions',
      returnPolicy: 'addListing.returnPolicy'
    };
    return this.translate.instant(keyMap[fieldName] || fieldName);
  }
}
