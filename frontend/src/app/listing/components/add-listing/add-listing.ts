import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ListingsService } from '../../../shared/services/listings.service';
import { CustomerService, CustomerInfo } from '../../../shared/services/customer.service';
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
  imports: [ReactiveFormsModule, TranslatePipe, HeaderComponent, FooterComponent],
  templateUrl: './add-listing.html',
  styleUrl: './add-listing.scss',
})
export class AddListing implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private listingsService = inject(ListingsService);
  private customerService = inject(CustomerService);
  private http = inject(HttpClient);
  private translate = inject(TranslateService);

  listingForm!: FormGroup;
  isSubmitting = false;
  errorMessage = '';
  isUploadingImages = false;
  isLoadingCustomer = true;
  isStripeConnected = false;
  customerLoadError = false;

  /** Active language tab in the description section */
  activeDescLang: 'en' | 'pt' | 'es' | 'fr' = 'en';
  readonly descLanguages: { code: 'en' | 'pt' | 'es' | 'fr'; label: string; flag: string }[] = [
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'pt', label: 'Português', flag: '🇵🇹' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'fr', label: 'Français', flag: '🇫🇷' }
  ];

  uploadedFiles: File[] = [];
  uploadedFileUrls: string[] = [];
  previewUrls: (string | ArrayBuffer | null)[] = [];

  // Drag-to-reorder state
  dragSrcIndex: number | null = null;
  dragOverIndex: number | null = null;

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
  /** Seller commission % for display (0.5 or 2 for private room). Base from environment. */
  commissionRate = 0.5;

  /** Buyer fee % for display (from environment) */
  get buyerFeeRatePct(): number {
    const rate = (environment as { bidroomFeeBuyerRate?: number }).bidroomFeeBuyerRate;
    return rate != null ? rate * 100 : 0.5;
  }

  /** At least one language description has ≥50 chars */
  get hasValidDescription(): boolean {
    const descs = this.listingForm.get('descriptions')?.value || {};
    return Object.values(descs).some((v: any) => v && v.trim().length >= 50);
  }

  /** Character count for a given language tab */
  descCharCount(lang: 'en' | 'pt' | 'es' | 'fr'): number {
    return this.listingForm.get('descriptions')?.get(lang)?.value?.length || 0;
  }

  /** Whether all required fields are valid and media is present */
  get canPublish(): boolean {
    return this.listingForm.valid && this.hasValidDescription && this.isMediaValid && this.uploadedFiles.length >= 1 && !this.isSubmitting && !this.isUploadingImages;
  }

  ngOnInit(): void {
    this.initializeForm();
    this.setupFormSubscriptions();
    this.loadCustomerInfo();
  }

  loadCustomerInfo(): void {
    this.customerService.getCustomer().subscribe({
      next: (info: CustomerInfo) => {
        this.isStripeConnected = info.airwallexOnboarded;
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
      condition: ['', Validators.required],
      descriptions: this.fb.group({
        en: [''],
        pt: [''],
        es: [''],
        fr: ['']
      }),
      media: this.fb.array([]),
      specifications: this.fb.array([]),
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
      this.commissionRate = enabled ? 2.0 : baseRatePct;
    });
    this.commissionRate = this.listingForm.get('allowPrivateRoom')?.value ? 2.0 : baseRatePct;
  }

  setupFormSubscriptions(): void {
    this.listingForm.get('category')?.valueChanges.subscribe(categoryId => {
      this.selectedCategory = this.categories.find(c => c.id === categoryId) || null;
      this.listingForm.patchValue({ subCategory: '' });
    });
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
    const rejected: string[] = [];
    let imgs = this.imageCount;
    let vids = this.videoCount;

    files.forEach(file => {
      const isImage = this.ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVideo = this.ALLOWED_VIDEO_TYPES.includes(file.type);

      if (isImage) {
        if (vids >= 1 && imgs >= 5) { rejected.push(file.name); return; }
        if (vids === 0 && imgs >= 20) { rejected.push(file.name); return; }
        this.uploadedFiles.push(file);
        imgs++;
        const reader = new FileReader();
        reader.onload = (e) => { this.previewUrls.push(e.target?.result || null); };
        reader.readAsDataURL(file);
      } else if (isVideo) {
        if (vids >= 1 || imgs >= 5) { rejected.push(file.name); return; }
        this.uploadedFiles.push(file);
        this.previewUrls.push(null);
        vids++;
      } else {
        rejected.push(file.name);
      }
    });

    if (rejected.length > 0) {
      this.errorMessage = this.translate.instant('addListing.errors.invalidFileType', { files: rejected.join(', ') });
    }
    while (this.media.length < this.uploadedFiles.length) {
      this.media.push(this.fb.control(this.uploadedFiles[this.media.length]));
    }
  }

  removeFile(index: number): void {
    if (index >= 0 && index < this.uploadedFiles.length) {
      this.uploadedFiles.splice(index, 1);
      this.previewUrls.splice(index, 1);
      if (this.media.length > index) {
        this.media.removeAt(index);
      }
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
    const rate = sellerRate != null ? (this.listingForm.get('allowPrivateRoom')?.value ? 0.02 : sellerRate) : (this.commissionRate / 100);
    return priceBasis * rate;
  }

  calculateEstimatedFees(): { commission: number; paymentProcessing: number; buyerFee: number; total: number } {
    const priceBasis = this.listingForm.get('startingBid')?.value ||
                      this.listingForm.get('buyNowPrice')?.value ||
                      this.listingForm.get('minimumAcceptPrice')?.value || 0;
    const envSeller = (environment as { bidroomFeeSellerRate?: number }).bidroomFeeSellerRate;
    const envBuyer = (environment as { bidroomFeeBuyerRate?: number }).bidroomFeeBuyerRate;
    const sellerRate = envSeller != null ? (this.listingForm.get('allowPrivateRoom')?.value ? 0.02 : envSeller) : (this.commissionRate / 100);
    const buyerRate = envBuyer ?? 0.005;
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

    if (!this.listingForm.valid || !this.hasValidDescription || this.uploadedFiles.length < 1 || !this.isMediaValid) {
      const fieldLabels: Record<string, string> = {
        title: 'Listing Title',
        category: 'Category',
        subCategory: 'Sub-Category',
        condition: 'Item Condition',
        descriptions: 'Description (min. 50 characters in at least one language)',
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
    } catch (error: any) {
      this.isSubmitting = false;
      this.errorMessage = error.message || error.error?.message || 'Failed to create listing. Please try again.';
    }
  }

  prepareListingData(): any {
    const formValue = this.listingForm.value;
    // Build descriptions map — only include non-empty values
    const rawDescs = formValue.descriptions || {};
    const descriptions: Record<string, string> = {};
    for (const lang of ['en', 'pt', 'es', 'fr'] as const) {
      if (rawDescs[lang] && rawDescs[lang].trim().length >= 50) {
        descriptions[lang] = rawDescs[lang].trim();
      }
    }
    // Canonical description: first filled language
    const description = descriptions['en'] || descriptions['pt'] || descriptions['es'] || descriptions['fr'] || '';
    return {
      title: formValue.title,
      description,
      descriptions,
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
      descriptions: 'addListing.description',
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
