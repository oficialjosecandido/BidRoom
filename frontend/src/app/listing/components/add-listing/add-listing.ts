import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray, AbstractControl } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ListingsService } from '../../../shared/services/listings.service';
import { API_CONFIG } from '../../../shared/config/api.config';
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
  imports: [CommonModule, ReactiveFormsModule, HeaderComponent, FooterComponent],
  templateUrl: './add-listing.html',
  styleUrl: './add-listing.scss',
})
export class AddListing implements OnInit {
  listingForm!: FormGroup;
  currentStep: number = 1;
  totalSteps: number = 4;
  isSubmitting = false;
  errorMessage = '';
  isUploadingImages = false;
  
  uploadedFiles: File[] = [];
  uploadedFileUrls: string[] = [];
  previewUrls: (string | ArrayBuffer | null)[] = [];

  // Categories (in real app, fetch from API)
  categories: Category[] = [
    {
      id: 'electronics',
      name: 'Electronics',
      subCategories: ['Vintage Cameras', 'Smartphones', 'Laptops', 'Audio Equipment', 'Gaming Consoles', 'Other']
    },
    {
      id: 'art-collectibles',
      name: 'Art & Collectibles',
      subCategories: ['Paintings', 'Sculptures', 'Antiques', 'Vintage Items', 'Memorabilia', 'Other']
    },
    {
      id: 'jewelry',
      name: 'Jewelry',
      subCategories: ['Rings', 'Necklaces', 'Watches', 'Bracelets', 'Earrings', 'Other']
    },
    {
      id: 'home-garden',
      name: 'Home & Garden',
      subCategories: ['Furniture', 'Decor', 'Kitchen Items', 'Garden Tools', 'Outdoor Equipment', 'Other']
    }
  ];

  itemConditions = [
    'New',
    'Used - Excellent',
    'Used - Very Good',
    'Used - Good',
    'Used - Fair',
    'For Parts or Not Working'
  ];

  listingDurations = [
    { value: '2 hours', label: '2 Hours' },
    { value: '24 hours', label: '24 Hours' },
    { value: '3 days', label: '3 Days' },
    { value: '7 days', label: '7 Days' }
  ];

  shippingOptions = [
    { value: 'flat-rate', label: 'Flat Rate' },
    { value: 'calculated', label: 'Calculated Shipping' },
    { value: 'local-pickup', label: 'Local Pickup Only' },
    { value: 'free', label: 'Free Shipping' }
  ];

  handlingTimes = [
    { value: 1, label: '1 Business Day' },
    { value: 2, label: '2 Business Days' },
    { value: 3, label: '3 Business Days' },
    { value: 5, label: '5 Business Days' },
    { value: 7, label: '7 Business Days' }
  ];

  returnPolicies = [
    { value: '30-days', label: '30 Day Returns' },
    { value: '14-days', label: '14 Day Returns' },
    { value: 'no-returns', label: 'No Returns Accepted' },
    { value: 'custom', label: 'Custom Policy' }
  ];

  selectedCategory: Category | null = null;
  commissionRate = 0.5; // Default 0.5%, 2.0% if Private Room enabled

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private listingsService: ListingsService,
    private http: HttpClient
  ) {}

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
      handlingTime: ['', Validators.required],
      returnPolicy: ['', Validators.required],
      sellerDeclaration: [false, Validators.requiredTrue]
    });

    // Conditional validators based on listing format
    this.listingForm.get('listingFormat')?.valueChanges.subscribe(format => {
      this.updateConditionalValidators(format);
    });

    // Conditional validators for shipping option
    this.listingForm.get('shippingOption')?.valueChanges.subscribe(option => {
      const flatRateControl = this.listingForm.get('flatRateShipping');
      if (option === 'flat-rate') {
        flatRateControl?.setValidators([Validators.required, Validators.min(0)]);
      } else {
        flatRateControl?.clearValidators();
      }
      flatRateControl?.updateValueAndValidity();
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
    const buyNowPriceControl = this.listingForm.get('buyNowPrice');
    const minimumAcceptPriceControl = this.listingForm.get('minimumAcceptPrice');

    if (format === 'auction') {
      startingBidControl?.setValidators([Validators.required, Validators.min(0.01)]);
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
      buyNowPriceControl?.clearValidators();
      minimumAcceptPriceControl?.setValidators([]);
    }

    startingBidControl?.updateValueAndValidity();
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
      Array.from(input.files).forEach(file => {
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          this.uploadedFiles.push(file);
          
          // Create preview
          const reader = new FileReader();
          reader.onload = (e) => {
            this.previewUrls.push(e.target?.result || null);
          };
          reader.readAsDataURL(file);
        }
      });
      
      // Update form array - add controls for each file
      while (this.media.length < this.uploadedFiles.length) {
        this.media.push(this.fb.control(this.uploadedFiles[this.media.length]));
      }
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
    const stepGroups: { [key: number]: string[] } = {
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
      if (this.currentStep < this.totalSteps) {
        this.currentStep++;
      }
    } else {
      // Mark all fields as touched to show validation errors
      const stepGroups: { [key: number]: string[] } = {
        1: ['title', 'category', 'subCategory', 'listingFormat', 'condition'],
        2: ['description', 'media', 'locationCity', 'locationRegion'],
        3: ['duration', 'startingBid', 'reservePrice', 'buyNowPrice', 'minimumAcceptPrice', 'allowPrivateRoom'],
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
          this.errorMessage = 'Please complete all required fields. The description must be at least 50 characters long.';
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
          this.errorMessage = 'Uploading images...';
          imageUrls = await this.uploadImages();
          
          if (imageUrls.length === 0) {
            throw new Error('Failed to upload images. Please try again.');
          }
        }
        
        // Step 2: Create listing with image URLs
        this.errorMessage = 'Creating listing...';
        const formData = this.prepareListingData();
        formData.images = imageUrls;
        
        const listing = await firstValueFrom(
          this.listingsService.createListing(formData)
        );
        
        this.isSubmitting = false;
        // Navigate to the newly created listing
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
        this.errorMessage = 'Please upload at least 1 image (3 recommended).';
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
      reservePrice: formValue.reservePrice || null,
      buyNowPrice: formValue.buyNowPrice || null,
      minimumOfferPrice: formValue.minimumAcceptPrice || null,
      allowPrivateRoom: formValue.allowPrivateRoom,
      commissionRate: this.commissionRate,
      location: `${formValue.locationCity}, ${formValue.locationRegion}`,
      shippingCost: formValue.flatRateShipping || (formValue.shippingOption === 'free' ? 0 : null),
      shippingOption: formValue.shippingOption,
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
        return `${this.getFieldLabel(fieldName)} is required`;
      }
      if (control.hasError('maxLength')) {
        return `${this.getFieldLabel(fieldName)} is too long`;
      }
      if (control.hasError('minLength')) {
        return `${this.getFieldLabel(fieldName)} is too short`;
      }
      if (control.hasError('min')) {
        return `Value must be greater than ${control.errors?.['min'].min}`;
      }
      if (control.hasError('mustBeHigherThanStartingBid')) {
        return 'Buy Now price must be higher than Starting Bid';
      }
    }
    return '';
  }

  getFieldLabel(fieldName: string): string {
    const labels: { [key: string]: string } = {
      title: 'Listing Title',
      category: 'Category',
      subCategory: 'Sub-Category',
      listingFormat: 'Listing Format',
      condition: 'Item Condition',
      description: 'Description',
      locationCity: 'City',
      locationRegion: 'Region/State',
      duration: 'Listing Duration',
      startingBid: 'Starting Bid',
      shippingOption: 'Shipping Option',
      handlingTime: 'Handling Time',
      returnPolicy: 'Return Policy'
    };
    return labels[fieldName] || fieldName;
  }

  isStep(step: number): boolean {
    return this.currentStep === step;
  }
}
