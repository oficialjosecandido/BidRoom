import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, computed, signal } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, ValidatorFn, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, from, merge, Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, switchMap, tap } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ListingsService, AttributeDef } from '../../../shared/services/listings.service';
import { CustomerService, CustomerInfo, SellerPaymentConfig } from '../../../shared/services/customer.service';
import { KycService, KYC_THRESHOLD } from '../../../shared/services/kyc.service';
import { estimateBuyerProcessingFeeEuros } from '../../../shared/utils/fees';
import { API_CONFIG } from '../../../shared/config/api.config';
import { environment } from '@env';
import { BidroomLogoComponent } from '../../../shared/components/bidroom-logo/bidroom-logo.component';
import { ThemeService } from '../../../shared/services/theme.service';
import { AnalyticsService } from '../../../shared/services/analytics.service';
import { AnalyticsEvents } from '../../../shared/services/analytics.events';
import { PostHogService } from '../../../shared/services/posthog.service';

interface Category {
  id: string;
  name: string;
  subCategories: string[];
}

interface PhotoHint {
  icon: string;
  label: string;
  /** If set, the hint is visually highlighted when the attribute equals true */
  attrKey?: string;
}

interface PhotoGuide {
  title: string;
  required: PhotoHint[];
  recommended: PhotoHint[];
}

const PHOTO_GUIDES: Record<string, PhotoGuide> = {
  // ── Relógios (Luxury + Vintage) ──────────────────────────────────────────
  'Luxury Watches': {
    title: 'photoGuide.watches.title',
    required: [
      { icon: '🕐', label: 'photoGuide.watches.front' },
      { icon: '🔄', label: 'photoGuide.watches.back' },
      { icon: '🔢', label: 'photoGuide.watches.serial' },
      { icon: '📜', label: 'photoGuide.watches.papers', attrKey: 'papersIncluded' },
      { icon: '📦', label: 'photoGuide.watches.box',    attrKey: 'boxIncluded' },
    ],
    recommended: [
      { icon: '⌚', label: 'photoGuide.watches.strap' },
      { icon: '👑', label: 'photoGuide.watches.crown' },
      { icon: '🖼️', label: 'photoGuide.watches.full' },
    ],
  },
  'Vintage Watches': {
    title: 'photoGuide.watches.title',
    required: [
      { icon: '🕐', label: 'photoGuide.watches.front' },
      { icon: '🔄', label: 'photoGuide.watches.back' },
      { icon: '🔢', label: 'photoGuide.watches.serial' },
      { icon: '📜', label: 'photoGuide.watches.papers', attrKey: 'papersIncluded' },
    ],
    recommended: [
      { icon: '⌚', label: 'photoGuide.watches.strap' },
      { icon: '🔎', label: 'photoGuide.watches.patina' },
      { icon: '🖼️', label: 'photoGuide.watches.full' },
    ],
  },
  // ── Arte ─────────────────────────────────────────────────────────────────
  'Paintings': {
    title: 'photoGuide.art.title',
    required: [
      { icon: '🖼️', label: 'photoGuide.art.full' },
      { icon: '✍️',  label: 'photoGuide.art.signature' },
      { icon: '🔎', label: 'photoGuide.art.detail' },
      { icon: '📜', label: 'photoGuide.art.cert', attrKey: 'certificate' },
    ],
    recommended: [
      { icon: '🔄', label: 'photoGuide.art.back' },
      { icon: '📐', label: 'photoGuide.art.frame' },
    ],
  },
  'Drawings': {
    title: 'photoGuide.art.title',
    required: [
      { icon: '🖼️', label: 'photoGuide.art.full' },
      { icon: '✍️',  label: 'photoGuide.art.signature' },
      { icon: '📜', label: 'photoGuide.art.cert', attrKey: 'certificate' },
    ],
    recommended: [
      { icon: '🔎', label: 'photoGuide.art.detail' },
      { icon: '🔄', label: 'photoGuide.art.back' },
    ],
  },
  'Prints': {
    title: 'photoGuide.art.title',
    required: [
      { icon: '🖼️', label: 'photoGuide.art.full' },
      { icon: '🔢', label: 'photoGuide.art.edition' },
      { icon: '✍️',  label: 'photoGuide.art.signature' },
    ],
    recommended: [
      { icon: '🔎', label: 'photoGuide.art.detail' },
      { icon: '📜', label: 'photoGuide.art.cert', attrKey: 'certificate' },
    ],
  },
  'Sculptures': {
    title: 'photoGuide.art.title',
    required: [
      { icon: '🖼️', label: 'photoGuide.art.full' },
      { icon: '🔄', label: 'photoGuide.art.multiangleScuplt' },
      { icon: '🔢', label: 'photoGuide.art.edition' },
    ],
    recommended: [
      { icon: '📜', label: 'photoGuide.art.cert', attrKey: 'certificate' },
      { icon: '🔎', label: 'photoGuide.art.detail' },
    ],
  },
  // ── Joalharia ────────────────────────────────────────────────────────────
  'Engagement Rings': {
    title: 'photoGuide.jewelry.title',
    required: [
      { icon: '💍', label: 'photoGuide.jewelry.full' },
      { icon: '🔎', label: 'photoGuide.jewelry.stone' },
      { icon: '🔢', label: 'photoGuide.jewelry.hallmark', attrKey: 'hallmark' },
      { icon: '📜', label: 'photoGuide.jewelry.cert', attrKey: 'certificate' },
    ],
    recommended: [
      { icon: '📏', label: 'photoGuide.jewelry.size' },
      { icon: '🔄', label: 'photoGuide.jewelry.side' },
    ],
  },
  'Wedding Rings': {
    title: 'photoGuide.jewelry.title',
    required: [
      { icon: '💍', label: 'photoGuide.jewelry.full' },
      { icon: '🔢', label: 'photoGuide.jewelry.hallmark', attrKey: 'hallmark' },
    ],
    recommended: [
      { icon: '📏', label: 'photoGuide.jewelry.size' },
      { icon: '📜', label: 'photoGuide.jewelry.cert', attrKey: 'certificate' },
    ],
  },
  'Loose Gemstones': {
    title: 'photoGuide.jewelry.title',
    required: [
      { icon: '💎', label: 'photoGuide.jewelry.gemFull' },
      { icon: '📜', label: 'photoGuide.jewelry.cert', attrKey: 'certificate' },
      { icon: '📏', label: 'photoGuide.jewelry.scale' },
    ],
    recommended: [
      { icon: '🔎', label: 'photoGuide.jewelry.stone' },
    ],
  },
  // ── Selos ────────────────────────────────────────────────────────────────
  'Definitive Stamps': {
    title: 'photoGuide.stamps.title',
    required: [
      { icon: '📬', label: 'photoGuide.stamps.front' },
      { icon: '🔄', label: 'photoGuide.stamps.back' },
    ],
    recommended: [
      { icon: '🔎', label: 'photoGuide.stamps.watermark' },
      { icon: '📐', label: 'photoGuide.stamps.margin' },
    ],
  },
  'Commemorative Stamps': {
    title: 'photoGuide.stamps.title',
    required: [
      { icon: '📬', label: 'photoGuide.stamps.front' },
      { icon: '🔄', label: 'photoGuide.stamps.back' },
    ],
    recommended: [
      { icon: '🔎', label: 'photoGuide.stamps.watermark' },
      { icon: '📐', label: 'photoGuide.stamps.margin' },
    ],
  },
  // ── Moedas ───────────────────────────────────────────────────────────────
  'Coins & Banknotes': {
    title: 'photoGuide.coins.title',
    required: [
      { icon: '🪙', label: 'photoGuide.coins.obverse' },
      { icon: '🔄', label: 'photoGuide.coins.reverse' },
      { icon: '📏', label: 'photoGuide.coins.edge' },
    ],
    recommended: [
      { icon: '📜', label: 'photoGuide.coins.cert', attrKey: 'certified' },
      { icon: '🔎', label: 'photoGuide.coins.detail' },
    ],
  },
};

/** Cross-field validator: buyNowPrice, when filled, must exceed startingBid. */
function buyNowAboveStartingBid(): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const buyNow   = group.get('buyNowPrice')?.value;
    const starting = group.get('startingBid')?.value;
    if (buyNow !== null && buyNow !== '' && Number(buyNow) > 0 &&
        starting !== null && starting !== '' && Number(buyNow) <= Number(starting)) {
      group.get('buyNowPrice')?.setErrors({ mustBeHigherThanStartingBid: true });
    } else {
      const ctrl = group.get('buyNowPrice');
      if (ctrl?.hasError('mustBeHigherThanStartingBid')) {
        const { mustBeHigherThanStartingBid: _, ...rest } = ctrl.errors ?? {};
        ctrl.setErrors(Object.keys(rest).length ? rest : null);
      }
    }
    return null; // errors live on the child control, not the group
  };
}

@Component({
  selector: 'app-add-listing',
  standalone: true,
  imports: [DecimalPipe, ReactiveFormsModule, TranslateModule, BidroomLogoComponent, RouterLink],
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
  private themeService = inject(ThemeService);
  private analytics = inject(AnalyticsService);
  private postHog = inject(PostHogService);

  listingForm!: FormGroup;
  activeLangTab: 'pt' | 'en' | 'fr' | 'es' = 'pt';
  primaryLangTab: 'pt' | 'en' | 'fr' | 'es' = 'pt';
  isSubmitting = false;
  errorMessage = '';
  isUploadingImages = false;
  isLoadingCustomer = true;
  isStripeConnected = false;
  customerLoadError = false;
  sellerPaymentConfig: SellerPaymentConfig = {};

  uploadedFiles: File[] = [];
  uploadedFileUrls: string[] = [];
  previewUrls: (string | ArrayBuffer | null)[] = [];

  dragSrcIndex: number | null = null;
  dragOverIndex: number | null = null;

  private readonly mediaChange$ = new Subject<void>();
  private draftAutosaveSub?: Subscription;
  private contentCheckSub?: Subscription;
  private readonly contentCheck$ = new Subject<{ title: string; description: string }>();
  contactWarning: { show: boolean; types: string[] } = { show: false, types: [] };
  private restoringDraft = false;
  private readonly urlByFileKey = new Map<string, string>();
  draftSaveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  draftSaveError = '';

  // ─── Step management ────────────────────────────────────────────────────────
  currentStep = 1;
  mobileStepsOpen = false;
  readonly totalSteps = 6;
  readonly isLight = computed(() => this.themeService.effective() === 'light');

  readonly steps = [
    { n: 1, titleKey: 'addListing.steps.format', subKey: 'addListing.steps.formatSub' },
    { n: 2, titleKey: 'addListing.steps.details', subKey: 'addListing.steps.detailsSub' },
    { n: 3, titleKey: 'addListing.steps.photos', subKey: 'addListing.steps.photosSub' },
    { n: 4, titleKey: 'addListing.steps.pricing', subKey: 'addListing.steps.pricingSub' },
    { n: 5, titleKey: 'addListing.steps.shipping', subKey: 'addListing.steps.shippingSub' },
    { n: 6, titleKey: 'addListing.steps.publish', subKey: 'addListing.steps.publishSub' },
  ];

  toggleTheme(): void {
    const eff = this.themeService.effective();
    this.themeService.setPreference(eff === 'dark' ? 'light' : 'dark');
  }

  get currentStepDef() {
    return this.steps.find((s) => s.n === this.currentStep);
  }

  toggleMobileSteps(): void {
    this.mobileStepsOpen = !this.mobileStepsOpen;
  }

  goStep(n: number): void {
    if (n < 1 || n > this.totalSteps) return;
    if (n <= this.currentStep) {
      this.currentStep = n;
      this.errorMessage = '';
      this.mobileStepsOpen = false;
      return;
    }
    for (let s = this.currentStep; s < n; s++) {
      if (!this.validateStep(s)) {
        this.currentStep = s;
        return;
      }
    }
    this.errorMessage = '';
    this.currentStep = n;
    this.mobileStepsOpen = false;
  }

  nextStep(): void {
    if (this.currentStep >= this.totalSteps) return;
    if (this.validateStep(this.currentStep)) {
      this.errorMessage = '';
      this.currentStep = this.currentStep + 1;
      this.mobileStepsOpen = false;
    }
  }

  prevStep(): void {
    if (this.currentStep > 1) {
      this.errorMessage = '';
      this.currentStep = this.currentStep - 1;
      this.mobileStepsOpen = false;
    }
  }
  navigateToDashboard(): void { void this.router.navigate(['/dashboard/home']); }
  navigateBack(): void { void this.router.navigate(['/listing/list']); }

  // ─── Preview sidebar ─────────────────────────────────────────────────────────
  get previewTitle(): string {
    return this.listingForm?.get(this.langTitleKey(this.primaryLangTab))?.value || '';
  }
  get previewCategory(): string { return this.listingForm?.get('category')?.value || ''; }
  get previewFormat(): string { return this.listingForm?.get('listingFormat')?.value || 'auction'; }

  get previewPrice(): string {
    const fmt = this.previewFormat;
    const v = fmt === 'auction'
      ? this.listingForm?.get('startingBid')?.value
      : this.listingForm?.get('minimumAcceptPrice')?.value;
    return v ? `€${parseFloat(v).toFixed(2)}` : '—';
  }

  get previewPriceLabel(): string {
    return this.previewFormat === 'auction'
      ? this.translate.instant('addListing.startingBid')
      : this.translate.instant('addListing.minimumAcceptPrice');
  }

  get previewDuration(): string {
    return this.getDurationLabel(this.listingForm?.get('duration')?.value);
  }

  get reviewDurationLabel(): string {
    return this.getDurationLabel(this.listingForm?.get('duration')?.value);
  }

  getDurationLabel(value: string | null | undefined): string {
    if (!value) return '—';
    const key = this.durationLabelKeys[value];
    if (!key) return value;
    const t = this.translate.instant(key);
    return t !== key ? t : value;
  }

  private readonly durationLabelKeys: Record<string, string> = {
    '5 minutes': 'addListing.duration5min',
    '1 hour': 'addListing.duration1hour',
    '2 hours': 'addListing.duration2hours',
    '7 hours': 'addListing.duration7hours',
    '24 hours': 'addListing.duration24hours',
    '3 days': 'addListing.duration3days',
    '7 days': 'addListing.duration7days',
    '10 days': 'addListing.duration10days',
    '15 days': 'addListing.duration15days',
    '30 days': 'addListing.duration30days',
  };

  get checklist(): Record<string, boolean> {
    const fmt = this.previewFormat;
    const tab = this.primaryLangTab;
    const titleCtrl = this.listingForm?.get(this.langTitleKey(tab));
    const descCtrl = this.listingForm?.get(this.langDescKey(tab));
    const shippingOk = this.isStepValid(5, false);
    return {
      format: true,
      title: !!titleCtrl?.valid,
      category: !!this.listingForm?.get('category')?.valid && !!this.listingForm?.get('subCategory')?.valid,
      condition: !!this.listingForm?.get('condition')?.valid,
      description: !!descCtrl?.valid,
      photos: this.uploadedFiles.length >= 1 && this.isMediaValid,
      price: fmt === 'best-offer' ? true : !!this.listingForm?.get('startingBid')?.valid,
      shipping: shippingOk,
    };
  }

  readonly checklistMeta: { key: string; labelKey: string }[] = [
    { key: 'format', labelKey: 'addListing.ck.format' },
    { key: 'title', labelKey: 'addListing.ck.title' },
    { key: 'category', labelKey: 'addListing.ck.category' },
    { key: 'condition', labelKey: 'addListing.ck.condition' },
    { key: 'description', labelKey: 'addListing.ck.desc' },
    { key: 'photos', labelKey: 'addListing.ck.photos' },
    { key: 'price', labelKey: 'addListing.ck.price' },
    { key: 'shipping', labelKey: 'addListing.ck.shipping' },
  ];

  get checklistDoneCount(): number {
    const c = this.checklist;
    return this.checklistMeta.filter((item) => c[item.key]).length;
  }

  get checklistProgressPct(): number {
    return Math.round((this.checklistDoneCount / this.checklistMeta.length) * 100);
  }

  get previewCategoryLabel(): string {
    const id = this.previewCategory;
    if (!id) return '';
    const key = `addListing.categories.${id}`;
    const t = this.translate.instant(key);
    return t !== key ? t : (this.categories.find((c) => c.id === id)?.name ?? id);
  }

  getSubCategoryLabel(sub: string): string {
    const key = `addListing.subcategories.${sub}`;
    const t = this.translate.instant(key);
    return t !== key ? t : sub;
  }

  get reviewCategoryLabel(): string {
    const catId = this.listingForm?.get('category')?.value;
    if (!catId) return '—';
    const catKey = `addListing.categories.${catId}`;
    const catLabel = this.translate.instant(catKey);
    return catLabel !== catKey ? catLabel : catId;
  }

  get reviewConditionLabel(): string {
    const val = this.listingForm?.get('condition')?.value;
    if (!val) return '—';
    const cond = this.itemConditions.find(c => c.value === val);
    return cond ? this.translate.instant(cond.labelKey) : val;
  }

  get reviewShippingLabel(): string {
    const val = this.listingForm?.get('shippingOption')?.value;
    if (!val) return '—';
    const opt = this.shippingOptions.find(o => o.value === val);
    return opt ? this.translate.instant(opt.labelKey) : val;
  }

  // ─── Categories ──────────────────────────────────────────────────────────────
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

  // Short durations (5 min, 1 h, 2 h) are only shown in non-production builds
  // so testers can create quick listings for private-room testing.
  listingDurations = [
    ...(!environment.production ? [
      { value: '5 minutes', labelKey: 'addListing.duration5min', hours: 1 / 12 },
      { value: '1 hour', labelKey: 'addListing.duration1hour', hours: 1 },
      { value: '2 hours', labelKey: 'addListing.duration2hours', hours: 2 },
    ] : []),
    { value: '24 hours', labelKey: 'addListing.duration24hours', hours: 24 },
    { value: '3 days', labelKey: 'addListing.duration3days', hours: 72 },
    { value: '7 days', labelKey: 'addListing.duration7days', hours: 168 },
    { value: '10 days', labelKey: 'addListing.duration10days', hours: 240 },
    { value: '15 days', labelKey: 'addListing.duration15days', hours: 360 },
  ];

  offerDurations = [
    { value: '3 days', labelKey: 'addListing.duration3days', hours: 72 },
    { value: '7 days', labelKey: 'addListing.duration7days', hours: 168 },
    { value: '15 days', labelKey: 'addListing.duration15days', hours: 360 },
    { value: '30 days', labelKey: 'addListing.duration30days', hours: 720 },
  ];

  itemCountries = [
    { value: 'PT', labelKey: 'addListing.countryPT' },
    { value: 'ES', labelKey: 'addListing.countryES' },
    { value: 'FR', labelKey: 'addListing.countryFR' },
    { value: 'DE', labelKey: 'addListing.countryDE' },
    { value: 'IT', labelKey: 'addListing.countryIT' },
    { value: 'GB', labelKey: 'addListing.countryGB' },
    { value: 'IE', labelKey: 'addListing.countryIE' },
    { value: 'NL', labelKey: 'addListing.countryNL' },
    { value: 'BE', labelKey: 'addListing.countryBE' },
    { value: 'CH', labelKey: 'addListing.countryCH' },
    { value: 'AT', labelKey: 'addListing.countryAT' },
    { value: 'LU', labelKey: 'addListing.countryLU' },
    { value: 'US', labelKey: 'addListing.countryUS' },
    { value: 'CA', labelKey: 'addListing.countryCA' },
    { value: 'AU', labelKey: 'addListing.countryAU' },
  ];

  shippingOptions = [
    { value: 'flat-rate',    labelKey: 'addListing.shippingFlatRate' },
    { value: 'free',         labelKey: 'addListing.shippingFree' },
    { value: 'calculated',   labelKey: 'addListing.shippingCalculated' },
    { value: 'local-pickup', labelKey: 'addListing.shippingLocalPickup' },
  ];

  returnPolicies = [
    { value: '30-days',    labelKey: 'addListing.return30' },
    { value: '14-days',    labelKey: 'addListing.return14' },
    { value: '7-days',     labelKey: 'addListing.return7' },
    { value: 'no-returns', labelKey: 'addListing.returnNo' },
  ];

  selectedCategory: Category | null = null;

  // ── Photo guide ───────────────────────────────────────────────────────────
  photoGuideOpen = true;

  get photoGuide(): PhotoGuide | null {
    const sub = this.listingForm?.get('subCategory')?.value as string;
    return PHOTO_GUIDES[sub] ?? null;
  }

  isAttrHighlighted(attrKey?: string): boolean {
    if (!attrKey) return false;
    return this.getAttrValue(attrKey) === true;
  }

  // ── Structured attributes ─────────────────────────────────────────────────
  attributeSchema = signal<AttributeDef[]>([]);
  private attributeSchemaSub?: Subscription;

  get attributesGroup(): FormGroup {
    return this.listingForm.get('attributes') as FormGroup;
  }

  get canPublish(): boolean {
    return this.listingForm.valid && this.isMediaValid && this.uploadedFiles.length >= 1 && !this.isSubmitting && !this.isUploadingImages;
  }

  ngOnInit(): void {
    const cl = this.translate.currentLang;
    const lang: 'pt' | 'en' | 'fr' | 'es' = (['pt', 'en', 'fr', 'es'] as const).includes(cl as any) ? cl as 'pt' | 'en' | 'fr' | 'es' : 'pt';
    this.activeLangTab = lang;
    this.primaryLangTab = lang;
    this.initializeForm();
    this.setupFormSubscriptions();
    void this.loadDraftFromServer();
    this.setupDraftAutosave();
    this.loadCustomerInfo();
  }

  ngOnDestroy(): void {
    this.draftAutosaveSub?.unsubscribe();
    this.contentCheckSub?.unsubscribe();
    this.attributeSchemaSub?.unsubscribe();
    this.mediaChange$.complete();
    this.contentCheck$.complete();
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
    this.customerService.getPaymentConfig().subscribe({
      next: (res) => {
        this.sellerPaymentConfig = res.paymentConfig ?? {};
        this.listingForm.patchValue({
          acceptPayInPerson: this.sellerPaymentConfig.inPerson ?? false,
          acceptPayBankTransfer: this.sellerPaymentConfig.bankTransfer?.enabled ?? false,
          acceptPayMbway: this.sellerPaymentConfig.mbway?.enabled ?? false,
        });
      },
      error: () => {}
    });
  }

  setLangTab(lang: 'pt' | 'en' | 'fr' | 'es'): void {
    this.activeLangTab = lang;
  }

  private langTitleKey(lang: string): string { return 'title' + lang[0].toUpperCase() + lang.slice(1); }
  private langDescKey(lang: string): string { return 'description' + lang[0].toUpperCase() + lang.slice(1); }

  private updateLangValidators(): void {
    const langs = ['pt', 'en', 'fr', 'es'] as const;
    langs.forEach(lang => {
      const t = this.listingForm.get(this.langTitleKey(lang));
      const d = this.listingForm.get(this.langDescKey(lang));
      if (!t || !d) return;
      if (lang === this.primaryLangTab) {
        t.setValidators([Validators.required, Validators.maxLength(80)]);
        d.setValidators([Validators.required, Validators.minLength(50)]);
      } else {
        t.setValidators([Validators.maxLength(80)]);
        d.setValidators([]);
      }
      t.updateValueAndValidity({ emitEvent: false });
      d.updateValueAndValidity({ emitEvent: false });
    });
  }

  initializeForm(): void {
    this.listingForm = this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(80)]],
      titlePt: ['', [Validators.required, Validators.maxLength(80)]],
      titleEn: ['', [Validators.maxLength(80)]],
      titleFr: ['', [Validators.maxLength(80)]],
      titleEs: ['', [Validators.maxLength(80)]],
      category: ['', Validators.required],
      subCategory: ['', Validators.required],
      listingFormat: ['best-offer', Validators.required],
      itemMode: ['single', Validators.required],
      quantity: [null],
      condition: ['', Validators.required],
      description: ['', [Validators.required, Validators.minLength(50)]],
      descriptionPt: ['', [Validators.required, Validators.minLength(50)]],
      descriptionEn: ['', []],
      descriptionFr: ['', []],
      descriptionEs: ['', []],
      media: this.fb.array([]),
      specifications: this.fb.array([]),
      attributes: this.fb.group({}),
      bundleItems: this.fb.array([]),
      locationCity: ['', Validators.required],
      locationCountry: ['PT', Validators.required],
      duration: ['7 days', Validators.required],
      startingBid: [null],
      buyNowPrice: [null],
      minimumAcceptPrice: [null],
      allowPrivateRoom: [false, Validators.required],
      shippingOption: ['', Validators.required],
      flatRateShipping: [null],
      packageSize: [''],
      shippingOriginPostalCode: [''],
      shippingOriginCity: [''],
      shippingOriginCountry: ['PT'],
      returnPolicy: ['14-days', Validators.required],
      acceptPayStripe: [true],
      acceptPayInPerson: [false],
      acceptPayBankTransfer: [false],
      acceptPayMbway: [false],
      sellerDeclaration: [false, Validators.requiredTrue]
    }, { validators: buyNowAboveStartingBid() });

    this.listingForm.get('listingFormat')?.valueChanges.subscribe(format => {
      this.updateConditionalValidators(format);
      if (format === 'best-offer') {
        this.listingForm.patchValue({ allowPrivateRoom: false });
      }
    });
    this.updateConditionalValidators(this.listingForm.get('listingFormat')?.value || 'best-offer');
    this.updateLangValidators();

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

    this.listingForm.get('acceptPayStripe')?.disable();

    this.listingForm.get('shippingOption')?.valueChanges.subscribe(option => {
      const flatRateControl    = this.listingForm.get('flatRateShipping');
      const packageSizeControl = this.listingForm.get('packageSize');
      const postalCodeControl  = this.listingForm.get('shippingOriginPostalCode');

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
  }

  setupFormSubscriptions(): void {
    this.listingForm.get('category')?.valueChanges.subscribe(categoryId => {
      this.selectedCategory = this.categories.find(c => c.id === categoryId) || null;
      this.listingForm.patchValue({ subCategory: '' });
    });

    this.listingForm.get('subCategory')?.valueChanges.subscribe(sub => {
      const cat = this.listingForm.get('category')?.value || '';
      if (!sub) { this.attributeSchema.set([]); this.buildAttributeControls([]); return; }
      this.attributeSchemaSub?.unsubscribe();
      this.attributeSchemaSub = this.listingsService.getAttributeSchema(sub, cat)
        .subscribe({ next: ({ schema }) => { this.attributeSchema.set(schema); this.buildAttributeControls(schema); }, error: () => {} });
    });

    // Keep generic `title`/`description` in sync with the primary language fields
    // so all existing validation, preview and checklist logic continues to work.
    const syncPrimary = () => {
      const tab = this.primaryLangTab;
      const t = this.listingForm.get(this.langTitleKey(tab))?.value ?? '';
      const d = this.listingForm.get(this.langDescKey(tab))?.value ?? '';
      this.listingForm.patchValue({ title: t, description: d }, { emitEvent: false });
    };
    ['titlePt', 'titleEn', 'titleFr', 'titleEs', 'descriptionPt', 'descriptionEn', 'descriptionFr', 'descriptionEs'].forEach(ctrl => {
      this.listingForm.get(ctrl)?.valueChanges.subscribe(() => {
        syncPrimary();
        this.triggerContentCheck();
      });
    });

    // Real-time contact-info check (advisory only — no violation recorded here).
    this.contentCheckSub = this.contentCheck$.pipe(
      debounceTime(600),
      distinctUntilChanged((a, b) => a.title === b.title && a.description === b.description),
      switchMap(payload => this.listingsService.validateContent(payload))
    ).subscribe({
      next: result => {
        this.contactWarning = { show: result.hasContactInfo, types: result.types };
      },
      error: () => {
        this.contactWarning = { show: false, types: [] };
      }
    });
  }

  private triggerContentCheck(): void {
    const title = ['titlePt', 'titleEn', 'titleFr', 'titleEs']
      .map(k => this.listingForm.get(k)?.value ?? '').join(' ').trim();
    const description = ['descriptionPt', 'descriptionEn', 'descriptionFr', 'descriptionEs']
      .map(k => this.listingForm.get(k)?.value ?? '').join(' ').trim();
    if (!title && !description) {
      this.contactWarning = { show: false, types: [] };
      return;
    }
    this.contentCheck$.next({ title, description });
  }

  getContactWarningMessage(): string {
    const types = this.contactWarning.types;
    const hasPhone = types.includes('phone');
    const hasEmail = types.includes('email');
    const hasUrl   = types.includes('url');
    if (hasPhone && hasEmail) return this.translate.instant('addListing.contactWarning.phoneEmail');
    if (hasPhone) return this.translate.instant('addListing.contactWarning.phone');
    if (hasEmail) return this.translate.instant('addListing.contactWarning.email');
    if (hasUrl)   return this.translate.instant('addListing.contactWarning.url');
    return this.translate.instant('addListing.contactWarning.generic');
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
    if (text(v['titlePt']) || text(v['titleEn']) || text(v['titleFr']) || text(v['titleEs'])) return true;
    if (text(v['descriptionPt']) || text(v['descriptionEn']) || text(v['descriptionFr']) || text(v['descriptionEs'])) return true;
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
      if (opts.manual) { this.draftSaveStatus = 'idle'; this.draftSaveError = ''; }
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
          toast: true, position: 'top-end', icon: 'success',
          title: this.translate.instant('addListing.draftSaved'),
          showConfirmButton: false, timer: 2200, timerProgressBar: true
        });
      }
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 401) { this.draftSaveStatus = 'idle'; return; }
      this.draftSaveStatus = 'error';
      this.draftSaveError = this.translate.instant('addListing.draftError');
      if (opts.manual) this.errorMessage = this.draftSaveError;
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
      // If the previous session published a listing, the draft was (or should be) deleted.
      // Clear the local invalidation flag and purge the server draft to be safe.
      if (localStorage.getItem('bidroom_draft_published')) {
        localStorage.removeItem('bidroom_draft_published');
        firstValueFrom(this.listingsService.deleteListingDraft()).catch(() => {});
        return;
      }

      const res = await firstValueFrom(this.listingsService.getListingDraft());
      const draft = res?.draft;
      if (!draft?.payload || typeof draft.payload !== 'object') return;

      this.restoringDraft = true;
      const p = draft.payload as Record<string, unknown>;

      const patch: Record<string, unknown> = {};
      const keys = [
        'title', 'category', 'subCategory', 'listingFormat', 'itemMode', 'quantity', 'condition', 'description',
        'titlePt', 'titleEn', 'titleFr', 'titleEs', 'descriptionPt', 'descriptionEn', 'descriptionFr', 'descriptionEs',
        'locationCity', 'locationCountry', 'duration', 'startingBid',
        'buyNowPrice', 'minimumAcceptPrice', 'allowPrivateRoom',
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
          this.specifications.push(this.fb.group({
            key: [r.key || '', Validators.required],
            value: [r.value || '', Validators.required]
          }));
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

      // Restore structured attributes — must happen after category/subCategory patch
      const savedAttrs = p['attributes'];
      if (savedAttrs && typeof savedAttrs === 'object' && !Array.isArray(savedAttrs)) {
        const subCat = patch['subCategory'] as string || '';
        const cat    = patch['category'] as string || '';
        if (subCat) {
          const { schema } = await firstValueFrom(this.listingsService.getAttributeSchema(subCat, cat));
          this.attributeSchema.set(schema);
          this.buildAttributeControls(schema);
          const attrPatch: Record<string, unknown> = {};
          for (const def of schema) {
            if ((savedAttrs as Record<string, unknown>)[def.key] !== undefined) {
              attrPatch[def.key] = (savedAttrs as Record<string, unknown>)[def.key];
            }
          }
          this.attributesGroup.patchValue(attrPatch, { emitEvent: false });
        }
      }

      const format = (patch['listingFormat'] as string) || this.listingForm.get('listingFormat')?.value;
      this.updateConditionalValidators(format || 'best-offer');

      const urls = p['imageUrls'];
      if (Array.isArray(urls) && urls.length > 0) {
        await this.hydrateMediaFromUrls(urls.filter((u): u is string => typeof u === 'string' && u.length > 0));
      }

      this.restoringDraft = false;
      void Swal.fire({
        toast: true, position: 'top-end', icon: 'info',
        title: this.translate.instant('addListing.draftRestored'),
        showConfirmButton: false, timer: 3500, timerProgressBar: true
      });
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 401) { this.restoringDraft = false; return; }
      this.restoringDraft = false;
    }
  }

  private async hydrateMediaFromUrls(urls: string[]): Promise<void> {
    this.uploadedFiles = [];
    this.previewUrls = [];
    while (this.media.length) this.media.removeAt(0);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      // Use a 0-byte placeholder so the existing indexed structure (uploadedFiles[i] ↔
      // previewUrls[i]) is maintained without any cross-origin fetch.  The URL is
      // pre-registered in urlByFileKey, so neither draft-save nor final-submit will
      // try to re-upload this image.
      const placeholder = new File([], `restored-${i}.jpg`, { type: 'image/jpeg' });
      this.urlByFileKey.set(this.fileKey(placeholder), url);
      this.uploadedFiles.push(placeholder);
      this.previewUrls.push(url);
      this.media.push(this.fb.control(placeholder));
    }
  }

  updateConditionalValidators(format: string): void {
    const startingBidControl        = this.listingForm.get('startingBid');
    const buyNowPriceControl        = this.listingForm.get('buyNowPrice');
    const minimumAcceptPriceControl = this.listingForm.get('minimumAcceptPrice');

    if (format === 'auction') {
      startingBidControl?.setValidators([Validators.required, Validators.min(0.01)]);
      buyNowPriceControl?.setValidators([Validators.min(0.01)]);
      minimumAcceptPriceControl?.clearValidators();
    } else if (format === 'best-offer') {
      startingBidControl?.clearValidators();
      buyNowPriceControl?.clearValidators();
      minimumAcceptPriceControl?.setValidators([]);
    }

    startingBidControl?.updateValueAndValidity();
    buyNowPriceControl?.updateValueAndValidity();
    minimumAcceptPriceControl?.updateValueAndValidity();
  }

  get specifications(): FormArray { return this.listingForm.get('specifications') as FormArray; }
  get media(): FormArray { return this.listingForm.get('media') as FormArray; }
  get bundleItems(): FormArray { return this.listingForm.get('bundleItems') as FormArray; }

  addBundleItem(): void {
    this.bundleItems.push(this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(100)]],
      description: ['', Validators.maxLength(500)]
    }));
  }

  removeBundleItem(index: number): void { this.bundleItems.removeAt(index); }

  getSelectedSubCategories(): string[] { return this.selectedCategory?.subCategories || []; }

  addSpecification(): void {
    this.specifications.push(this.fb.group({
      key: ['', Validators.required],
      value: ['', Validators.required]
    }));
  }

  removeSpecification(index: number): void { this.specifications.removeAt(index); }

  private buildAttributeControls(schema: AttributeDef[]): void {
    const current = this.attributesGroup;
    // Remove controls no longer in schema
    Object.keys(current.controls).forEach(k => {
      if (!schema.find(d => d.key === k)) current.removeControl(k);
    });
    // Add / update controls for current schema
    for (const def of schema) {
      if (!current.contains(def.key)) {
        const validators = def.required ? [Validators.required] : [];
        current.addControl(def.key, this.fb.control('', validators));
      }
    }
  }

  getAttrValue(key: string): unknown {
    return this.attributesGroup?.get(key)?.value;
  }

  setAttrValue(key: string, val: unknown): void {
    this.attributesGroup?.get(key)?.setValue(val);
    this.attributesGroup?.get(key)?.markAsDirty();
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
    if (files && files.length > 0) this.addFiles(files);
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

  /** Maximum allowed video file size: 15 MB */
  private readonly MAX_VIDEO_SIZE_BYTES = 15 * 1024 * 1024;

  get imageCount(): number { return this.uploadedFiles.filter(f => this.ALLOWED_IMAGE_TYPES.includes(f.type)).length; }
  get videoCount(): number { return this.uploadedFiles.filter(f => this.ALLOWED_VIDEO_TYPES.includes(f.type)).length; }
  isVideoFile(file: File): boolean { return this.ALLOWED_VIDEO_TYPES.includes(file.type); }

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
    const rejected: { name: string; reason: 'type' | 'maxPhotos' | 'maxPhotosWithVideo' | 'videoLimit' | 'videoSize' }[] = [];
    let imgs = this.imageCount;
    let vids = this.videoCount;

    files.forEach(file => {
      const isImage = this.ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVideo = this.ALLOWED_VIDEO_TYPES.includes(file.type);

      if (isImage) {
        if (vids >= 1 && imgs >= 5) { rejected.push({ name: file.name, reason: 'maxPhotosWithVideo' }); return; }
        if (vids === 0 && imgs >= 20) { rejected.push({ name: file.name, reason: 'maxPhotos' }); return; }
        this.uploadedFiles.push(file);
        imgs++;
        const reader = new FileReader();
        reader.onload = (e) => { this.previewUrls.push(e.target?.result || null); };
        reader.readAsDataURL(file);
      } else if (isVideo) {
        if (vids >= 1 || imgs >= 5) { rejected.push({ name: file.name, reason: 'videoLimit' }); return; }
        // Enforce 100 MB size limit before the file is accepted
        if (file.size > this.MAX_VIDEO_SIZE_BYTES) { rejected.push({ name: file.name, reason: 'videoSize' }); return; }
        this.uploadedFiles.push(file);
        this.previewUrls.push(null);
        vids++;
      } else {
        rejected.push({ name: file.name, reason: 'type' });
      }
    });

    if (this.uploadedFiles.length > countBefore) this.notifyMediaChanged();

    if (rejected.length > 0) {
      const byReason = new Map<typeof rejected[number]['reason'], string[]>();
      for (const r of rejected) {
        const list = byReason.get(r.reason) ?? [];
        list.push(r.name);
        byReason.set(r.reason, list);
      }
      const parts: string[] = [];
      const joinFiles = (names: string[]) => names.join(', ');
      if (byReason.has('type')) parts.push(this.translate.instant('addListing.errors.invalidFileType', { files: joinFiles(byReason.get('type')!) }));
      if (byReason.has('maxPhotos')) parts.push(this.translate.instant('addListing.errors.mediaMaxPhotos', { files: joinFiles(byReason.get('maxPhotos')!) }));
      if (byReason.has('maxPhotosWithVideo')) parts.push(this.translate.instant('addListing.errors.mediaMaxPhotosWithVideo', { files: joinFiles(byReason.get('maxPhotosWithVideo')!) }));
      if (byReason.has('videoLimit')) parts.push(this.translate.instant('addListing.errors.mediaVideoLimit', { files: joinFiles(byReason.get('videoLimit')!) }));
      if (byReason.has('videoSize')) parts.push(this.translate.instant('addListing.errors.mediaVideoSize', { files: joinFiles(byReason.get('videoSize')!) }));
      this.errorMessage = parts.join(' ');
    }
    while (this.media.length < this.uploadedFiles.length) {
      this.media.push(this.fb.control(this.uploadedFiles[this.media.length]));
    }
  }

  removeFile(index: number): void {
    if (index >= 0 && index < this.uploadedFiles.length) {
      const prev = this.previewUrls[index];
      if (typeof prev === 'string' && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      this.uploadedFiles.splice(index, 1);
      this.previewUrls.splice(index, 1);
      if (this.media.length > index) this.media.removeAt(index);
      this.notifyMediaChanged();
    }
  }

  onThumbDragStart(index: number, event: DragEvent): void {
    this.dragSrcIndex = index;
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('text/plain', String(index));
  }

  onThumbDragOver(index: number, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = 'move';
    this.dragOverIndex = index;
  }

  onThumbDragLeave(): void { this.dragOverIndex = null; }

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

  onThumbDragEnd(): void { this.dragSrcIndex = null; this.dragOverIndex = null; }

  getFeeForecastPriceBasis(): number {
    const n = (name: string): number => {
      const raw = this.listingForm.get(name)?.value;
      const v = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
      return Number.isFinite(v) && v > 0 ? v : 0;
    };
    const map = n('minimumAcceptPrice');
    if (map > 0) return map;
    const format = this.listingForm.get('listingFormat')?.value;
    if (format === 'auction') return n('startingBid');
    return n('buyNowPrice') || n('startingBid');
  }

  sellerFeeRateDecimal(): number {
    const env = environment as { bidroomFeeSellerRate?: number; bidroomFeePrivateRoomRate?: number };
    const base = env.bidroomFeeSellerRate ?? 0.035;
    const privateRate = env.bidroomFeePrivateRoomRate ?? 0.06;
    const format = this.listingForm.get('listingFormat')?.value;
    const privateRoom = !!this.listingForm.get('allowPrivateRoom')?.value;
    if (format === 'auction' && privateRoom) return privateRate;
    return base;
  }

  get sellerFeeRatePct(): number { return this.sellerFeeRateDecimal() * 100; }
  get sellerFeeRateDisplay(): string {
    const r = this.sellerFeeRatePct;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  estimatedSellerFeeAmount(): number {
    return this.getFeeForecastPriceBasis() * this.sellerFeeRateDecimal();
  }

  estimatedBuyerProcessingFee(): number {
    return estimateBuyerProcessingFeeEuros(this.getFeeForecastPriceBasis());
  }

  async uploadImages(): Promise<string[]> {
    if (this.uploadedFiles.length === 0) return [];
    this.isUploadingImages = true;
    try {
      // Only upload files that don't already have a server URL (new additions that
      // were not yet draft-saved, or files that are not 0-byte restored placeholders).
      const filesToUpload = this.uploadedFiles.filter(
        f => this.ALLOWED_IMAGE_TYPES.includes(f.type)
          && f.size > 0
          && !this.urlByFileKey.has(this.fileKey(f))
      );
      if (filesToUpload.length > 0) {
        const formData = new FormData();
        filesToUpload.forEach(file => formData.append('images', file));
        const response = await firstValueFrom(
          this.http.post<{ urls: string[]; count: number }>(`${API_CONFIG.getApiUrl()}/uploads`, formData)
        );
        const urls = response.urls || [];
        filesToUpload.forEach((file, idx) => {
          if (urls[idx]) this.urlByFileKey.set(this.fileKey(file), urls[idx]);
        });
      }
      this.uploadedFileUrls = this.buildOrderedImageUrlList();
      this.isUploadingImages = false;
      return this.uploadedFileUrls;
    } catch (error: any) {
      this.isUploadingImages = false;
      const isContentViolation = error?.error?.error === 'Content policy violation';
      const msg = error?.error?.message || error?.message || 'Failed to upload images. Please try again.';
      const enriched = Object.assign(new Error(msg), { isContentViolation });
      throw enriched;
    }
  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting || this.isUploadingImages) return;

    Object.keys(this.listingForm.controls).forEach(key => {
      this.listingForm.get(key)?.markAsTouched();
    });

    if (!this.listingForm.valid || this.uploadedFiles.length < 1 || !this.isMediaValid) {
      Object.keys(this.listingForm.controls).forEach(key => {
        this.listingForm.get(key)?.markAsTouched();
      });
      this.specifications.controls.forEach(c => c.markAllAsTouched());
      this.bundleItems.controls.forEach(c => c.markAllAsTouched());
      const firstInvalid = this.findFirstInvalidStep();
      if (firstInvalid) {
        this.currentStep = firstInvalid;
        this.validateStep(firstInvalid);
      }
      this.errorMessage = this.buildPublishValidationMessage();
      return;
    }

    // If the real-time scanner still shows contact info, give one last chance to review
    // before hitting the endpoint that records a violation.
    if (this.contactWarning.show) {
      const result = await Swal.fire({
        icon: 'warning',
        title: this.translate.instant('addListing.contactWarning.dialogTitle'),
        html: `<p style="font-size:0.92em;color:#374151">${this.getContactWarningMessage()}</p>
               <p style="font-size:0.82em;margin-top:0.75em;color:#6b7280">
                 ${this.translate.instant('addListing.contactWarning.dialogSub')}
               </p>`,
        showCancelButton: true,
        confirmButtonText: this.translate.instant('addListing.contactWarning.dialogReview'),
        cancelButtonText:  this.translate.instant('addListing.contactWarning.dialogPublish'),
        confirmButtonColor: '#2563eb',
        cancelButtonColor:  '#dc2626',
        reverseButtons: true,
      });
      if (result.isConfirmed) return; // user chose to review — no penalty
      // user chose "Publish anyway" — fall through and let the backend decide
    }

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
      if (imageUrls.length === 0) throw new Error(this.translate.instant('addListing.errorUploadFailed'));

      this.errorMessage = this.translate.instant('addListing.creatingListing');
      const formData = this.prepareListingData();
      formData.images = imageUrls;

      const listing = await firstValueFrom(this.listingsService.createListing(formData));

      this.analytics.trackEvent(AnalyticsEvents.LISTING_PUBLISHED, {
        ...this.analytics.listingParams(listing),
        listing_format: formData.listingFormat ?? '',
        allow_private_room: !!formData.allowPrivateRoom,
      });
      this.postHog.track(AnalyticsEvents.LISTING_PUBLISHED, {
        ...this.analytics.listingParams(listing),
        listing_format: formData.listingFormat ?? '',
        allow_private_room: !!formData.allowPrivateRoom,
        starting_price: formData.startingPrice ?? 0,
        image_count: imageUrls.length,
      });

      this.isSubmitting = false;
      this.errorMessage = '';
      // Mark draft as published locally before deleting — guards against a failed DELETE
      // leaving a stale draft that would be restored on the next "new listing" visit.
      localStorage.setItem('bidroom_draft_published', '1');
      await firstValueFrom(this.listingsService.deleteListingDraft()).catch(() => {});
      localStorage.removeItem('bidroom_draft_published'); // clean up if delete succeeded

      if (listing.contentWarning) {
        await Swal.fire({
          icon: 'warning',
          title: this.translate.instant('addListing.moderationTitle'),
          html: `<p>${this.translate.instant('addListing.moderationBody')}</p>`,
          confirmButtonText: this.translate.instant('addListing.moderationCta'),
          confirmButtonColor: '#2563eb'
        });
        // Navigate to the listing — it is visible to the seller but not to the public
        this.router.navigate(['/listing', listing.slug]);
      } else {
        Swal.fire({
          toast: true, position: 'top-end', icon: 'success',
          title: this.translate.instant('addListing.successMessage'),
          showConfirmButton: false, timer: 3000, timerProgressBar: true
        });
        this.router.navigate(['/listing', listing.slug]);
      }
    } catch (error: any) {
      this.isSubmitting = false;

      // Image blocked by content moderation — show a prominent modal
      if (error?.isContentViolation) {
        Swal.fire({
          icon: 'error',
          title: 'Image Not Allowed',
          html: `<p>${error.message}</p>
                 <p style="font-size:0.82em;margin-top:0.75em;color:#6b7280">
                   Remove or replace the flagged image(s) and try again.
                   Repeated violations may lead to account restrictions.
                 </p>`,
          confirmButtonText: 'OK',
          confirmButtonColor: '#dc2626'
        });
        this.errorMessage = '';
        return;
      }

      if (error?.error?.error === 'kyc_required') {
        this.kycService.openKycGate(error.error.kycStatus || 'none');
        return;
      }
      const apiErr = error?.error?.message || error?.error?.error;
      this.errorMessage = apiErr || error.message || 'Failed to create listing. Please try again.';
    }
  }

  prepareListingData(): any {
    const formValue = this.listingForm.value;
    return {
      title: formValue.title,
      description: formValue.description,
      titlePt: formValue.titlePt || null,
      titleEn: formValue.titleEn || null,
      titleFr: formValue.titleFr || null,
      titleEs: formValue.titleEs || null,
      descriptionPt: formValue.descriptionPt || null,
      descriptionEn: formValue.descriptionEn || null,
      descriptionFr: formValue.descriptionFr || null,
      descriptionEs: formValue.descriptionEs || null,
      category: formValue.category,
      subCategory: formValue.subCategory,
      condition: formValue.condition,
      listingFormat: formValue.listingFormat,
      duration: formValue.duration,
      startingPrice: formValue.startingBid || null,
      buyNowPrice: formValue.buyNowPrice || null,
      minimumOfferPrice: formValue.minimumAcceptPrice || null,
      allowPrivateRoom: formValue.allowPrivateRoom,
      commissionRate: this.sellerFeeRatePct,
      locationCity: formValue.locationCity?.trim(),
      locationCountry: formValue.locationCountry,
      location: `${formValue.locationCity?.trim()}, ${formValue.locationCountry}`,
      shippingCost: formValue.flatRateShipping || (formValue.shippingOption === 'free' ? 0 : null),
      shippingOption: formValue.shippingOption,
      packageSize: formValue.shippingOption === 'calculated' ? formValue.packageSize : null,
      shippingOriginPostalCode: formValue.shippingOption === 'calculated' ? formValue.shippingOriginPostalCode : null,
      shippingOriginCity: formValue.shippingOption === 'calculated' ? formValue.shippingOriginCity : null,
      shippingOriginCountry: formValue.shippingOption === 'calculated' ? (formValue.shippingOriginCountry || 'PT') : null,
      returnPolicy: formValue.returnPolicy,
      acceptedPaymentMethods: {
        stripe: formValue.acceptPayStripe !== false,
        inPerson: formValue.acceptPayInPerson === true,
        bankTransfer: formValue.acceptPayBankTransfer === true,
        mbway: formValue.acceptPayMbway === true,
      },
      specifications: formValue.specifications || [],
      attributes: formValue.attributes || {},
      itemMode: formValue.itemMode || 'single',
      quantity: formValue.itemMode === 'multi_quantity' ? (formValue.quantity || 2) : 1,
      bundleItems: formValue.itemMode === 'bundle' ? (formValue.bundleItems || []) : [],
      images: this.uploadedFileUrls
    };
  }

  private getStepFields(step: number): string[] {
    switch (step) {
      case 1:
        return ['listingFormat'];
      case 2:
        return [
          this.langTitleKey(this.primaryLangTab),
          'category', 'subCategory', 'condition',
          this.langDescKey(this.primaryLangTab),
        ];
      case 3:
        return [];
      case 4:
        return this.listingForm.get('listingFormat')?.value === 'auction'
          ? ['startingBid', 'duration']
          : ['duration'];
      case 5: {
        const fields = ['shippingOption', 'locationCity', 'locationCountry', 'returnPolicy'];
        const opt = this.listingForm.get('shippingOption')?.value;
        if (opt === 'flat-rate') fields.push('flatRateShipping');
        if (opt === 'calculated') fields.push('packageSize', 'shippingOriginPostalCode');
        return fields;
      }
      case 6:
        return ['sellerDeclaration'];
      default:
        return [];
    }
  }

  private isStepValid(step: number, markTouched: boolean): boolean {
    if (step === 3) {
      if (markTouched) { /* media has no form controls */ }
      return this.uploadedFiles.length >= 1 && this.isMediaValid;
    }

    const fields = this.getStepFields(step);
    if (markTouched) {
      fields.forEach(f => this.listingForm.get(f)?.markAsTouched());
      if (step === 2) {
        this.specifications.controls.forEach(c => c.markAllAsTouched());
      }
    }

    if (fields.some(f => this.listingForm.get(f)?.invalid)) return false;
    if (step === 2 && this.specifications.length > 0 && this.specifications.invalid) return false;
    if (step === 2 && this.attributesGroup?.invalid) return false;
    return true;
  }

  validateStep(step: number): boolean {
    if (this.isStepValid(step, true)) {
      return true;
    }
    this.errorMessage = this.getStepValidationMessage(step);
    return false;
  }

  private getStepValidationMessage(step: number): string {
    switch (step) {
      case 2: {
        const descKey = this.langDescKey(this.primaryLangTab);
        const descCtrl = this.listingForm.get(descKey);
        if (descCtrl?.hasError('minlength') || descCtrl?.hasError('required')) {
          return this.translate.instant('addListing.errorStep2Description');
        }
        if (this.attributesGroup?.invalid) {
          const invalidAttrs = this.attributeSchema()
            .filter(def => def.required && this.attributesGroup.get(def.key)?.invalid)
            .map((def: { label: string }) => def.label);
          if (invalidAttrs.length > 0) {
            return this.translate.instant('addListing.errors.requiredAttributes', { fields: invalidAttrs.join(', ') });
          }
        }
        return this.translate.instant('addListing.errors.stepBlocked');
      }
      case 3:
        return this.uploadedFiles.length < 1
          ? this.translate.instant('addListing.errors.atLeastOnePhoto')
          : this.translate.instant('addListing.uploadMediaError');
      case 4:
        return this.translate.instant('addListing.errors.step4Pricing');
      case 5:
        return this.translate.instant('addListing.errors.step5Shipping');
      case 6:
        return this.translate.instant('addListing.errors.step6Declaration');
      default:
        return this.translate.instant('addListing.errors.stepBlocked');
    }
  }

  private findFirstInvalidStep(): number | null {
    for (let s = 1; s <= this.totalSteps; s++) {
      if (!this.isStepValid(s, false)) return s;
    }
    return null;
  }

  private buildPublishValidationMessage(): string {
    const missing = this.collectInvalidFieldLabels();
    if (missing.length > 0) {
      return this.translate.instant('addListing.errors.publishIncomplete', { fields: missing.join(', ') });
    }
    return this.translate.instant('addListing.errors.publishFix');
  }

  private collectInvalidFieldLabels(): string[] {
    const keys = [
      this.langTitleKey(this.primaryLangTab),
      'category', 'subCategory', 'condition',
      this.langDescKey(this.primaryLangTab),
      'startingBid', 'duration', 'shippingOption', 'flatRateShipping',
      'packageSize', 'shippingOriginPostalCode',
      'locationCity', 'locationCountry', 'returnPolicy', 'sellerDeclaration',
    ];
    const missing: string[] = [];
    if (this.uploadedFiles.length < 1 || !this.isMediaValid) {
      missing.push(this.translate.instant('addListing.errors.atLeastOnePhoto'));
    }
    keys.forEach(key => {
      if (this.listingForm.get(key)?.invalid) {
        missing.push(this.getFieldLabel(key));
      }
    });
    if (this.specifications.length > 0 && this.specifications.invalid) {
      missing.push(this.translate.instant('addListing.errors.specificationsIncomplete'));
    }
    return missing;
  }

  getFieldError(fieldName: string): string {
    const control = this.listingForm.get(fieldName);
    if (control && control.invalid && (control.touched || control.dirty)) {
      if (control.hasError('required')) {
        return this.translate.instant('addListing.errors.required', { field: this.getFieldLabel(fieldName) });
      }
      if (control.hasError('maxLength')) {
        return this.translate.instant('addListing.errors.tooLong', { field: this.getFieldLabel(fieldName) });
      }
      if (control.hasError('minlength') || control.hasError('minLength')) {
        const min = control.errors?.['minlength']?.requiredLength ?? control.errors?.['minLength']?.requiredLength ?? 50;
        return this.translate.instant('addListing.errors.tooShortMin', {
          field: this.getFieldLabel(fieldName),
          min,
        });
      }
      if (control.hasError('min')) {
        return this.translate.instant('addListing.errors.minValue', { min: control.errors?.['min'].min });
      }
      if (control.hasError('mustBeHigherThanStartingBid')) {
        return this.translate.instant('addListing.errors.buyNowTooLow');
      }
    }
    return '';
  }

  getFieldLabel(fieldName: string): string {
    const keyMap: Record<string, string> = {
      title: 'addListing.listingTitle',
      titlePt: 'addListing.titlePt',
      titleEn: 'addListing.titleEn',
      category: 'addListing.category',
      subCategory: 'addListing.subCategory',
      listingFormat: 'addListing.listingFormat',
      condition: 'addListing.condition',
      description: 'addListing.description',
      descriptionPt: 'addListing.descriptionPt',
      descriptionEn: 'addListing.descriptionEn',
      locationCity: 'addListing.city',
      locationCountry: 'addListing.itemCountry',
      duration: 'addListing.duration',
      startingBid: 'addListing.startingBid',
      shippingOption: 'addListing.shippingOptions',
      returnPolicy: 'addListing.returnPolicy',
      sellerDeclaration: 'addListing.sellerDeclaration',
      flatRateShipping: 'addListing.flatRateCost',
      packageSize: 'addListing.packageSize',
      shippingOriginPostalCode: 'addListing.originPostalCode',
    };
    return this.translate.instant(keyMap[fieldName] || fieldName);
  }
}
