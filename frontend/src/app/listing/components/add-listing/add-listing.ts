import { Component, OnInit, inject } from '@angular/core';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ListingsService } from '../../../shared/services/listings.service';
import { API_CONFIG } from '../../../shared/config/api.config';
import { environment } from '../../../../environments/environment';
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
export class AddListing implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private listingsService = inject(ListingsService);
  private http = inject(HttpClient);
  private translate = inject(TranslateService);

  readonly enableAuctions = environment.enableAuctions ?? true;
  readonly enablePrivateRooms = environment.enablePrivateRooms ?? true;

  listingForm!: FormGroup;
  currentStep = 1;
  totalSteps = 4;
  isSubmitting = false;
  errorMessage = '';
  isUploadingImages = false;
  
  uploadedFiles: File[] = [];
  uploadedFileUrls: string[] = [];
  previewUrls: (string | ArrayBuffer | null)[] = [];

  // Categories
  categories: Category[] = [
    {
      id: 'electronics',
      name: 'Electronics',
      subCategories: [
        // Computers
        'Laptops', 'Desktop Computers', 'Computer Components',
        // Mobile Devices
        'Smartphones', 'Tablets', 'Mobile Accessories',
        // Audio
        'Headphones', 'Speakers', 'Hi Fi Systems', 'Turntables',
        // Gaming
        'Gaming Consoles', 'Video Games', 'Gaming Accessories',
        // Cameras & Photography
        'Digital Cameras', 'Film Cameras', 'Camera Lenses', 'Camera Accessories',
        // TV & Video
        'Televisions', 'Projectors', 'Streaming Devices',
        // Wearables
        'Smart Watches', 'Fitness Trackers', 'Wearables Accessories',
        // Other
        'Other Electronics'
      ]
    },
    {
      id: 'home-garden',
      name: 'Home & Garden',
      subCategories: [
        // Furniture
        'Tables', 'Chairs', 'Cabinets', 'Shelves', 'Beds',
        // Home Decor
        'Lamps', 'Mirrors', 'Vases', 'Wall Decor', 'Decorative Objects',
        // Kitchen & Dining
        'Cookware', 'Tableware', 'Glassware', 'Barware',
        // Garden & Outdoor
        'Garden Furniture', 'Garden Tools', 'Outdoor Decor', 'Planters',
        // Textiles
        'Rugs', 'Curtains', 'Blankets', 'Cushions',
        // Other
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
        // Stamps
        'Stamps',
        // Collectibles
        'Coins & Banknotes', 'Trading Cards', 'Toys & Models',
        // Memorabilia
        'Sports Memorabilia', 'Music Memorabilia', 'Movie Memorabilia',
        // Other
        'Vintage Items', 'Other Collectibles'
      ]
    },
    {
      id: 'jewelry',
      name: 'Jewelry',
      subCategories: [
        // Rings
        'Engagement Rings', 'Wedding Rings', 'Fashion Rings',
        // Necklaces
        'Chains', 'Pendants',
        // Bracelets
        'Bangles', 'Charm Bracelets',
        // Earrings
        'Stud Earrings', 'Hoop Earrings', 'Drop Earrings',
        // Watches
        'Luxury Watches', 'Vintage Watches', 'Smart Watches',
        // Other
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

  listingDurations = environment.auctionDurations.map(d => ({
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

  handlingTimes = [
    { value: 1, labelKey: 'addListing.handling1' },
    { value: 2, labelKey: 'addListing.handling2' },
    { value: 3, labelKey: 'addListing.handling3' },
    { value: 5, labelKey: 'addListing.handling5' },
    { value: 7, labelKey: 'addListing.handling7' }
  ];

  returnPolicies = [
    { value: '30-days', labelKey: 'addListing.return30' },
    { value: '14-days', labelKey: 'addListing.return14' },
    { value: 'no-returns', labelKey: 'addListing.returnNo' },
    { value: 'custom', labelKey: 'addListing.returnCustom' }
  ];

  selectedCategory: Category | null = null;
  commissionRate = 0.5;

  ngOnInit(): void {
    this.initializeForm();
    this.setupFormSubscriptions();
  }

  initializeForm(): void {
    this.listingForm = this.fb.group({
      // Step 1: Item Identity and Format
      title: ['', [Validators.required, Validators.maxLength(80)]],
      category: ['', Validators.required],
      subCategory: ['', Validators.required],
      listingFormat: ['auction', Validators.required],
      condition: ['', Validators.required],
      
      // Step 2: Details and Media
      description: ['', [Validators.required, Validators.minLength(50)]],
      media: this.fb.array([]),
      specifications: this.fb.array([]),
      locationCity: ['', Validators.required],
      locationRegion: ['', Validators.required],
      
      // Step 3: Pricing and Auction Rules
      duration: ['', Validators.required],
      startingBid: [null],
      reservePrice: [null],
      buyNowPrice: [null],
      minimumAcceptPrice: [null],
      allowPrivateRoom: [false, Validators.required],
      
      // Step 4: Shipping and Final Review
      shippingOption: ['', Validators.required],
      flatRateShipping: [null],
      packageSize: [''],
      shippingOriginPostalCode: [''],
      shippingOriginCity: [''],
      shippingOriginCountry: ['US'],
      handlingTime: ['', Validators.required],
      returnPolicy: ['', Validators.required],
      sellerDeclaration: [false, Validators.requiredTrue]
    });

    // Lock to best-offer if auctions are disabled in this environment
    if (!this.enableAuctions) {
      this.listingForm.patchValue({ listingFormat: 'best-offer' });
    }

    // Conditional validators based on listing format
    this.listingForm.get('listingFormat')?.valueChanges.subscribe(format => {
      this.updateConditionalValidators(format);
      // Private Room is only for Highest Bid (auction); clear it when switching to Best Offer
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
    this.listingForm.get('allowPrivateRoom')?.valueChanges.subscribe(enabled => {
      this.commissionRate = enabled ? 2.0 : 0.5;
    });
  }

  setupFormSubscriptions(): void {
    // Reset subCategory when category changes
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
      
      // Buy Now must be higher than Starting Bid
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
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp'
  ];

  private addFiles(fileList: FileList | File[]): void {
    this.errorMessage = '';
    const files = Array.from(fileList);
    const rejected: string[] = [];
    files.forEach(file => {
      if (this.ALLOWED_IMAGE_TYPES.includes(file.type)) {
        this.uploadedFiles.push(file);
        const reader = new FileReader();
        reader.onload = (e) => {
          this.previewUrls.push(e.target?.result || null);
        };
        reader.readAsDataURL(file);
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


  isStepValid(step: number): boolean {
    const stepGroups: Record<number, string[]> = {
      1: ['title', 'category', 'subCategory', 'listingFormat', 'condition'],
      2: ['description', 'media', 'locationCity', 'locationRegion'],
      3: ['duration', 'allowPrivateRoom'],
      4: ['shippingOption', 'handlingTime', 'returnPolicy', 'sellerDeclaration']
    };
    
    const controls = stepGroups[step] || [];
    
    if (step === 3) {
      const format = this.listingForm.get('listingFormat')?.value;
      if (format === 'auction') {
        if (!controls.includes('startingBid')) {
          controls.push('startingBid');
        }
      }
    }
    
    if (step === 4) {
      const shippingOption = this.listingForm.get('shippingOption')?.value;
      if (shippingOption === 'flat-rate') {
        if (!controls.includes('flatRateShipping')) {
          controls.push('flatRateShipping');
        }
      }
    }
    
    // Special validation for step 2 - check media files
    // TODO: Re-enable this requirement once file upload is fully implemented
    // For now, allow proceeding with at least 1 file for testing
    if (step === 2) {
      if (this.uploadedFiles.length < 1) {
        return false;
      }
    }
    
    // Validate all controls in the step
    const allValid = controls.every(controlName => {
      const control = this.listingForm.get(controlName);
      if (!control) return true; // Skip if control doesn't exist
      
      // For media, check the uploaded files count instead
      // TODO: Change back to >= 3 once file upload is implemented
      if (controlName === 'media') {
        return this.uploadedFiles.length >= 1;
      }
      
      return control.valid;
    });
    
    return allValid;
  }

  nextStep(): void {
    if (this.isStepValid(this.currentStep)) {
      this.errorMessage = '';
      if (this.currentStep < this.totalSteps) {
        this.currentStep++;
      }
    } else {
      // Mark all fields as touched to show validation errors
      const stepGroups: Record<number, string[]> = {
        1: ['title', 'category', 'subCategory', 'listingFormat', 'condition'],
        2: ['description', 'media', 'locationCity', 'locationRegion'],
        3: ['duration', 'startingBid', 'buyNowPrice', 'minimumAcceptPrice', 'allowPrivateRoom'],
        4: ['shippingOption', 'flatRateShipping', 'handlingTime', 'returnPolicy', 'sellerDeclaration']
      };
      
      const controls = stepGroups[this.currentStep] || [];
      controls.forEach(controlName => {
        const control = this.listingForm.get(controlName);
        if (control) {
          control.markAsTouched();
          // For description, also mark as dirty to show error
          if (controlName === 'description' && control.invalid) {
            control.markAsDirty();
          }
        }
      });
      
      // Show a more visible error message
      if (this.currentStep === 2) {
        const description = this.listingForm.get('description');
        if (description?.invalid) {
          this.errorMessage = this.translate.instant('addListing.errorStep2Description');
          // Clear error message after 5 seconds
          setTimeout(() => this.errorMessage = '', 5000);
        }
      }
    }
  }

  previousStep(): void {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  goToStep(step: number): void {
    // Only allow going to previous steps or next valid step
    if (step >= 1 && step <= this.totalSteps) {
      // Check if all previous steps are valid
      let canGoToStep = true;
      for (let i = 1; i < step; i++) {
        if (!this.isStepValid(i)) {
          canGoToStep = false;
          break;
        }
      }
      
      if (canGoToStep || step < this.currentStep) {
        this.currentStep = step;
      }
    }
  }

  calculateEstimatedCommission(): number {
    const startingBid = this.listingForm.get('startingBid')?.value || 0;
    const buyNowPrice = this.listingForm.get('buyNowPrice')?.value || 0;
    const minimumAcceptPrice = this.listingForm.get('minimumAcceptPrice')?.value || 0;
    
    // Use the highest price as basis for commission calculation
    const priceBasis = Math.max(startingBid, buyNowPrice, minimumAcceptPrice);
    
    return priceBasis * (this.commissionRate / 100);
  }

  calculateEstimatedFees(): {
    commission: number;
    paymentProcessing: number;
    total: number;
  } {
    const priceBasis = this.listingForm.get('startingBid')?.value || 
                      this.listingForm.get('buyNowPrice')?.value || 
                      this.listingForm.get('minimumAcceptPrice')?.value || 0;
    
    const commission = priceBasis * (this.commissionRate / 100);
    const paymentProcessing = priceBasis * 0.029 + 0.30; // Standard Stripe-like fee
    const total = commission + paymentProcessing;
    
    return {
      commission,
      paymentProcessing,
      total
    };
  }

  async uploadImages(): Promise<string[]> {
    if (this.uploadedFiles.length === 0) {
      return [];
    }
    
    this.isUploadingImages = true;
    
    try {
      const formData = new FormData();
      this.uploadedFiles.forEach(file => {
        formData.append('images', file);
      });

      const response = await firstValueFrom(
        this.http.post<{ urls: string[]; count: number }>(
          `${API_CONFIG.getApiUrl()}/uploads`,
          formData
          // Note: Don't set Content-Type header - browser will set it with boundary for multipart/form-data
        )
      );

      this.uploadedFileUrls = response.urls || [];
      this.isUploadingImages = false;
      return this.uploadedFileUrls;
    } catch (error: any) {
      this.isUploadingImages = false;
      console.error('Error uploading images:', error);
      throw new Error(error.error?.message || 'Failed to upload images. Please try again.');
    }
  }

  async onSubmit(): Promise<void> {
    if (this.listingForm.valid && this.uploadedFiles.length >= 1) {
      this.isSubmitting = true;
      this.errorMessage = '';
      
      try {
        // Step 1: Upload images to Azure Blob Storage
        let imageUrls: string[] = [];
        
        if (this.uploadedFiles.length > 0) {
          this.errorMessage = this.translate.instant('addListing.uploadingImages');
          imageUrls = await this.uploadImages();
          
          if (imageUrls.length === 0) {
            throw new Error(this.translate.instant('addListing.errorUploadFailed'));
          }
        }

        // Step 2: Create listing with image URLs
        this.errorMessage = this.translate.instant('addListing.creatingListing');
        const formData = this.prepareListingData();
        formData.images = imageUrls;
        
        const listing = await firstValueFrom(
          this.listingsService.createListing(formData)
        );
        
        this.isSubmitting = false;
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
        console.error('Error creating listing:', error);
      }
    } else {
      // Mark all fields as touched
      Object.keys(this.listingForm.controls).forEach(key => {
        this.listingForm.get(key)?.markAsTouched();
      });
      
      if (this.uploadedFiles.length < 1) {
        this.errorMessage = this.translate.instant('addListing.uploadMinError');
      }
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
      listingFormat: formValue.listingFormat, // 'auction' or 'best-offer'
      duration: formValue.duration,
      startingPrice: formValue.startingBid || null,
      reservePrice: formValue.listingFormat === 'auction' ? null : (formValue.reservePrice || null),
      buyNowPrice: formValue.buyNowPrice || null,
      minimumOfferPrice: formValue.minimumAcceptPrice || null,
      allowPrivateRoom: formValue.allowPrivateRoom,
      commissionRate: this.commissionRate,
      location: `${formValue.locationCity}, ${formValue.locationRegion}`,
      shippingCost: formValue.flatRateShipping || (formValue.shippingOption === 'free' ? 0 : null),
      shippingOption: formValue.shippingOption,
      packageSize: formValue.shippingOption === 'calculated' ? formValue.packageSize : null,
      shippingOriginPostalCode: formValue.shippingOption === 'calculated' ? formValue.shippingOriginPostalCode : null,
      shippingOriginCity: formValue.shippingOption === 'calculated' ? formValue.shippingOriginCity : null,
      shippingOriginCountry: formValue.shippingOption === 'calculated' ? (formValue.shippingOriginCountry || 'US') : null,
      handlingTime: formValue.handlingTime,
      returnPolicy: formValue.returnPolicy,
      specifications: formValue.specifications || [],
      images: this.uploadedFileUrls // Will be populated with uploaded image URLs
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
      duration: 'addListing.duration',
      startingBid: 'addListing.startingBid',
      reservePrice: 'addListing.reservePrice',
      shippingOption: 'addListing.shippingOptions',
      handlingTime: 'addListing.handlingTime',
      returnPolicy: 'addListing.returnPolicy'
    };
    return this.translate.instant(keyMap[fieldName] || fieldName);
  }

  isStep(step: number): boolean {
    return this.currentStep === step;
  }
}
