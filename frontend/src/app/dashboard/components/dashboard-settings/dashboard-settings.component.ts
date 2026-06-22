import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { CustomerService, SellerCompliance, SellerPaymentConfig } from '../../../shared/services/customer.service';
import { ThemePreference, ThemeService } from '../../../shared/services/theme.service';
import { StripeConnectService, ConnectAccountStatus, OnboardingFormData } from '../../../shared/services/stripe-connect.service';
import { NotificationPreferencesService, NotificationPreferences, NOTIFICATION_EVENT_KEYS, DEFAULT_CHANNEL_PREF } from '../../../shared/services/notification-preferences.service';
import { BuyerPaymentService, PaymentMethodsResponse, SavedPaymentMethod } from '../../../shared/services/buyer-payment.service';
import { ListingsService } from '../../../shared/services/listings.service';
import { loadStripe, Stripe, StripeElements, StripeCardElement } from '@stripe/stripe-js';
import { Observable } from 'rxjs';
import { PostHogService } from '../../../shared/services/posthog.service';
import { AnalyticsEvents } from '../../../shared/services/analytics.events';

@Component({
  selector: 'app-dashboard-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './dashboard-settings.component.html',
  styleUrls: ['./dashboard-settings.component.scss']
})
export class DashboardSettingsComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private customerService = inject(CustomerService);
  private translate = inject(TranslateService);
  readonly theme = inject(ThemeService);
  private stripeConnect = inject(StripeConnectService);
  private notifPrefsService = inject(NotificationPreferencesService);
  private buyerPaymentService = inject(BuyerPaymentService);
  private listingsService = inject(ListingsService);
  private postHog = inject(PostHogService);

  private sellerListingCount = 0;

  /** Review averages use the same 1–5 star scale as transaction reviews. */
  readonly reviewScoreMax = 5;

  currentUser$: Observable<AppUser | null>;
  buyerScore: number | null = null;
  sellerScore: number | null = null;
  buyerReviewCount = 0;
  sellerReviewCount = 0;

  connectStatus: ConnectAccountStatus | null = null;
  connectLoading = false;
  connectSubmitting = false;
  connectTestActivating = false;
  connectStatusMessage: string | null = null;
  connectError: string | null = null;
  showOnboardingForm = false;

  get isStripeTestMode(): boolean { return this.stripeConnect.isTestMode; }

  // Seller payout onboarding (BidRoom collects KYC via API)
  dobDay: number | null = null;
  dobMonth: number | null = null;
  dobYear: number | null = null;
  addressLine1 = '';
  addressCity = '';
  addressPostal = '';
  addressCountry = 'PT';
  iban = '';
  tosAccepted = false;

  readonly countries = [
    { code: 'AT', label: 'Austria' }, { code: 'BE', label: 'Belgium' },
    { code: 'BG', label: 'Bulgaria' }, { code: 'HR', label: 'Croatia' },
    { code: 'CY', label: 'Cyprus' }, { code: 'CZ', label: 'Czech Republic' },
    { code: 'DK', label: 'Denmark' }, { code: 'EE', label: 'Estonia' },
    { code: 'FI', label: 'Finland' }, { code: 'FR', label: 'France' },
    { code: 'DE', label: 'Germany' }, { code: 'GR', label: 'Greece' },
    { code: 'HU', label: 'Hungary' }, { code: 'IE', label: 'Ireland' },
    { code: 'IT', label: 'Italy' }, { code: 'LV', label: 'Latvia' },
    { code: 'LT', label: 'Lithuania' }, { code: 'LU', label: 'Luxembourg' },
    { code: 'MT', label: 'Malta' }, { code: 'NL', label: 'Netherlands' },
    { code: 'NO', label: 'Norway' }, { code: 'PL', label: 'Poland' },
    { code: 'PT', label: 'Portugal' }, { code: 'RO', label: 'Romania' },
    { code: 'SK', label: 'Slovakia' }, { code: 'SI', label: 'Slovenia' },
    { code: 'ES', label: 'Spain' }, { code: 'SE', label: 'Sweden' },
    { code: 'CH', label: 'Switzerland' }, { code: 'GB', label: 'United Kingdom' },
    { code: 'US', label: 'United States' }, { code: 'CA', label: 'Canada' },
    { code: 'AU', label: 'Australia' }
  ];

  selectedLanguage = 'en';
  langSaving = false;
  langSaved = false;

  /** DSA seller / trader compliance (from User via profile API). */
  sellerComplianceAvailable = false;
  sellerClassification: 'private' | 'professional' = 'private';
  professionalLegalName = '';
  professionalTradeName = '';
  professionalAddressLine1 = '';
  professionalAddressLine2 = '';
  professionalCity = '';
  professionalRegion = '';
  professionalPostalCode = '';
  professionalCountry = 'PT';
  professionalContactPhone = '';
  professionalContactEmail = '';
  professionalVatId = '';
  professionalVerificationStatus: SellerCompliance['professionalVerificationStatus'] = 'none';
  professionalSubmittedAt: string | null = null;
  professionalVerifiedAt: string | null = null;
  professionalRejectionNote: string | null = null;
  dsaSaving = false;
  dsaError: string | null = null;
  dsaSaved = false;

  // Payment method (Buyer Trust Tier 3)
  paymentMethods: SavedPaymentMethod[] = [];
  paymentTrustTier = 0;
  loadingPaymentMethod = true;
  settingDefaultId: string | null = null;
  removingPaymentId: string | null = null;
  removeModalMethod: SavedPaymentMethod | null = null;
  removeModalError: string | null = null;
  showAddCard = false;
  savingCard = false;
  cardError: string | null = null;
  private stripe: Stripe | null = null;
  private stripeElements: StripeElements | null = null;
  private cardElement: StripeCardElement | null = null;

  // ── Seller alternative payment config ──────────────────────────────────────
  sellerPmInPerson = false;
  sellerPmBankEnabled = false;
  sellerPmBankIban = '';
  sellerPmBankName = '';
  sellerPmMbwayEnabled = false;
  sellerPmMbwayPhone = '';
  savingPaymentConfig = false;
  paymentConfigSaved = false;
  paymentConfigError: string | null = null;

  readonly notifEventKeys = NOTIFICATION_EVENT_KEYS;
  notifPrefs: NotificationPreferences | null = null;
  notifPrefsLoading = false;
  notifPrefsLoadError: string | null = null;
  notifPrefsSaving = false;
  notifPrefsSaved = false;
  notifPrefsError: string | null = null;

  readonly themeChoices: { id: ThemePreference; labelKey: string }[] = [
    { id: 'light', labelKey: 'dashboard.settings.appearance.light' },
    { id: 'dark', labelKey: 'dashboard.settings.appearance.dark' },
    { id: 'system', labelKey: 'dashboard.settings.appearance.system' }
  ];

  readonly languages = [
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'pt', label: 'Português', flag: '🇵🇹' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'fr', label: 'Français', flag: '🇫🇷' }
  ];

  constructor() {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    this.selectedLanguage = this.translate.currentLang || localStorage.getItem('lang') || 'en';

    this.customerService.getCustomer().subscribe({
      next: (info) => {
        this.buyerScore = info.buyerScore ?? null;
        this.sellerScore = info.sellerScore ?? null;
        this.buyerReviewCount = info.buyerReviewCount ?? 0;
        this.sellerReviewCount = info.sellerReviewCount ?? 0;
        if (info.language) {
          this.selectedLanguage = info.language;
          this.translate.use(info.language);
          localStorage.setItem('lang', info.language);
        }
        this.applySellerComplianceFromProfile(info.sellerCompliance ?? null);
      }
    });

    this.loadConnectStatus();
    this.loadNotifPrefs();
    this.loadPaymentMethod();
    this.loadSellerListingCount();
    this.loadPaymentConfig();
  }

  /** Has listed at least one item (active or ended), same rule as dashboard home. */
  get isSellerUser(): boolean {
    return this.sellerListingCount > 0;
  }

  private loadSellerListingCount(): void {
    this.listingsService.getMyListings().subscribe({
      next: (response) => {
        const all = response.listings ?? [];
        const now = new Date();
        const active = all.filter(
          (l) => l.status === 'active' && new Date(l.endDate) > now
        ).length;
        const ended = all.filter(
          (l) => l.status === 'ended' || l.status === 'cancelled' || (l.status === 'active' && new Date(l.endDate) <= now)
        ).length;
        this.sellerListingCount = active + ended;
      }
    });
  }

  private loadPaymentConfig(): void {
    this.customerService.getPaymentConfig().subscribe({
      next: (res) => {
        const cfg = res.paymentConfig ?? {};
        this.sellerPmInPerson = cfg.inPerson ?? false;
        this.sellerPmBankEnabled = cfg.bankTransfer?.enabled ?? false;
        this.sellerPmBankIban = cfg.bankTransfer?.iban ?? '';
        this.sellerPmBankName = cfg.bankTransfer?.accountName ?? '';
        this.sellerPmMbwayEnabled = cfg.mbway?.enabled ?? false;
        this.sellerPmMbwayPhone = cfg.mbway?.phone ?? '';
      },
      error: () => {}
    });
  }

  savePaymentConfig(): void {
    this.savingPaymentConfig = true;
    this.paymentConfigSaved = false;
    this.paymentConfigError = null;
    const config: SellerPaymentConfig = {
      inPerson: this.sellerPmInPerson,
      bankTransfer: {
        enabled: this.sellerPmBankEnabled,
        iban: this.sellerPmBankIban.trim() || null,
        accountName: this.sellerPmBankName.trim() || null,
      },
      mbway: {
        enabled: this.sellerPmMbwayEnabled,
        phone: this.sellerPmMbwayPhone.trim() || null,
      }
    };
    this.customerService.updatePaymentConfig(config).subscribe({
      next: () => {
        this.savingPaymentConfig = false;
        this.paymentConfigSaved = true;
        setTimeout(() => (this.paymentConfigSaved = false), 3000);
      },
      error: () => {
        this.savingPaymentConfig = false;
        this.paymentConfigError = this.translate.instant('dashboard.settings.sellerPaymentConfig.saveError');
      }
    });
  }

  ngOnDestroy(): void {
    this.cardElement?.destroy();
  }

  get hasPaymentMethods(): boolean {
    return this.paymentMethods.length > 0;
  }

  loadPaymentMethod(): void {
    this.buyerPaymentService.getPaymentMethods().subscribe({
      next: (res) => {
        this.applyPaymentMethods(res);
        this.loadingPaymentMethod = false;
      },
      error: () => { this.loadingPaymentMethod = false; }
    });
  }

  private applyPaymentMethods(res: PaymentMethodsResponse): void {
    this.paymentMethods = res.methods ?? [];
    this.paymentTrustTier = res.trustTier ?? 0;
  }

  canRemoveMethod(method: SavedPaymentMethod): boolean {
    return !method.isDefault && this.paymentMethods.length > 1;
  }

  toggleAddCard(): void {
    this.showAddCard = !this.showAddCard;
    if (this.showAddCard) {
      this.initStripeElements();
    } else {
      this.cardElement?.destroy();
      this.cardElement = null;
      this.cardError = null;
    }
  }

  async initStripeElements(): Promise<void> {
    const pk = (window as any).APP_CONFIG?.STRIPE_PUBLISHABLE_KEY;
    if (!pk) return;
    this.stripe = await loadStripe(pk);
    this.stripeElements = this.stripe!.elements();
    this.cardElement = this.stripeElements.create('card', {
      hidePostalCode: true,
      style: { base: { fontFamily: 'DM Sans, sans-serif', fontSize: '14px', color: 'var(--text)' } }
    });
    setTimeout(() => this.cardElement?.mount('#card-element'), 0);
  }

  async saveCard(): Promise<void> {
    if (!this.stripe || !this.cardElement) return;
    this.savingCard = true;
    this.cardError = null;

    this.buyerPaymentService.createSetupIntent().subscribe({
      next: async (res) => {
        const { error, setupIntent } = await this.stripe!.confirmCardSetup(res.clientSecret, {
          payment_method: { card: this.cardElement! }
        });
        if (error) {
          this.cardError = error.message ?? this.translate.instant('dashboard.settings.paymentMethod.saveError');
          this.savingCard = false;
          return;
        }
        if (!setupIntent?.id) {
          this.cardError = this.translate.instant('dashboard.settings.paymentMethod.saveError');
          this.savingCard = false;
          return;
        }
        this.buyerPaymentService.confirmPaymentMethod(setupIntent.id).subscribe({
          next: (saved) => {
            this.applyPaymentMethods(saved);
            this.showAddCard = false;
            this.savingCard = false;
            this.cardElement?.destroy();
            this.cardElement = null;
            this.cardError = null;
          },
          error: () => {
            this.cardError = this.translate.instant('dashboard.settings.paymentMethod.saveError');
            this.savingCard = false;
          }
        });
      },
      error: () => {
        this.cardError = this.translate.instant('dashboard.settings.paymentMethod.setupError');
        this.savingCard = false;
      }
    });
  }

  setDefaultCard(method: SavedPaymentMethod): void {
    if (method.isDefault || this.settingDefaultId) return;
    this.settingDefaultId = method.id;
    this.buyerPaymentService.setDefaultPaymentMethod(method.id).subscribe({
      next: (res) => {
        this.applyPaymentMethods(res);
        this.settingDefaultId = null;
      },
      error: () => { this.settingDefaultId = null; }
    });
  }

  openRemoveModal(method: SavedPaymentMethod): void {
    if (!this.canRemoveMethod(method)) return;
    this.removeModalError = null;
    this.removeModalMethod = method;
  }

  closeRemoveModal(): void {
    if (this.removingPaymentId) return;
    this.removeModalMethod = null;
    this.removeModalError = null;
  }

  confirmRemoveCard(): void {
    const method = this.removeModalMethod;
    if (!method || !this.canRemoveMethod(method) || this.removingPaymentId) return;

    this.removingPaymentId = method.id;
    this.removeModalError = null;
    this.buyerPaymentService.deletePaymentMethod(method.id).subscribe({
      next: (res) => {
        this.applyPaymentMethods(res);
        this.removingPaymentId = null;
        this.removeModalMethod = null;
      },
      error: (err) => {
        this.removingPaymentId = null;
        const code = err.error?.code;
        const key = code === 'DEFAULT_PAYMENT_METHOD'
          ? 'dashboard.settings.paymentMethod.cannotRemoveDefault'
          : code === 'ONLY_PAYMENT_METHOD'
            ? 'dashboard.settings.paymentMethod.cannotRemoveOnly'
            : null;
        this.removeModalError = key
          ? this.translate.instant(key)
          : (err.error?.message ?? this.translate.instant('dashboard.settings.paymentMethod.removeError'));
      }
    });
  }

  saveLanguage(): void {
    this.langSaving = true;
    this.translate.use(this.selectedLanguage);
    localStorage.setItem('lang', this.selectedLanguage);
    this.customerService.updateLanguage(this.selectedLanguage).subscribe({
      next: () => {
        this.langSaving = false;
        this.langSaved = true;
        setTimeout(() => this.langSaved = false, 2500);
      },
      error: () => { this.langSaving = false; }
    });
  }

  loadConnectStatus(): void {
    this.connectLoading = true;
    this.stripeConnect.getAccountStatus().subscribe({
      next: (status) => { this.connectStatus = status; this.connectLoading = false; },
      error: () => { this.connectLoading = false; }
    });
  }

  openOnboardingForm(): void {
    this.connectError = null;
    this.showOnboardingForm = true;
    this.postHog.track(AnalyticsEvents.SELLER_ONBOARDING_STARTED);
  }

  cancelOnboardingForm(): void {
    this.showOnboardingForm = false;
    this.connectError = null;
  }

  submitOnboarding(): void {
    this.connectError = null;
    if (!this.dobDay || !this.dobMonth || !this.dobYear) {
      this.connectError = this.translate.instant('dashboard.settings.dobRequired');
      return;
    }
    if (!this.addressLine1 || !this.addressCity || !this.addressPostal || !this.addressCountry) {
      this.connectError = this.translate.instant('dashboard.settings.addressRequired');
      return;
    }
    if (!this.iban.trim()) {
      this.connectError = this.translate.instant('dashboard.settings.ibanRequired');
      return;
    }
    if (!this.tosAccepted) {
      this.connectError = this.translate.instant('dashboard.settings.tosRequired');
      return;
    }

    const data: OnboardingFormData = {
      dobDay: this.dobDay,
      dobMonth: this.dobMonth,
      dobYear: this.dobYear,
      addressLine1: this.addressLine1,
      addressCity: this.addressCity,
      addressPostal: this.addressPostal,
      addressCountry: this.addressCountry,
      iban: this.iban,
      tosAccepted: this.tosAccepted
    };

    this.connectSubmitting = true;
    this.stripeConnect.submitOnboarding(data).subscribe({
      next: (res) => {
        this.connectSubmitting = false;
        this.showOnboardingForm = false;
        this.connectStatusMessage = res.onboarded
          ? this.translate.instant('dashboard.settings.payoutNowActive')
          : this.translate.instant('dashboard.settings.detailsSubmitted');
        this.postHog.track(AnalyticsEvents.PAYOUT_DETAILS_ADDED, { onboarded: res.onboarded });
        this.loadConnectStatus();
      },
      error: (err) => {
        this.connectSubmitting = false;
        this.connectError = err?.error?.message || err?.error?.error || this.translate.instant('dashboard.settings.connectError');
      }
    });
  }

  testActivate(): void {
    this.connectTestActivating = true;
    this.stripeConnect.testActivate().subscribe({
      next: () => {
        this.connectTestActivating = false;
        this.connectStatusMessage = this.translate.instant('dashboard.settings.testActivated');
        this.loadConnectStatus();
      },
      error: (err) => {
        this.connectTestActivating = false;
        this.connectError = err?.error?.error || this.translate.instant('dashboard.settings.testActivationFailed');
      }
    });
  }

  loadNotifPrefs(): void {
    this.notifPrefsLoading = true;
    this.notifPrefsLoadError = null;
    this.notifPrefsService.getPreferences().subscribe({
      next: (prefs) => {
        this.notifPrefs = this.normalizeNotifPrefs(prefs);
        this.notifPrefsLoading = false;
      },
      error: () => {
        this.notifPrefsLoading = false;
        this.notifPrefsLoadError = this.translate.instant('dashboard.settings.notifications.loadError');
      }
    });
  }

  private normalizeNotifPrefs(prefs: NotificationPreferences): NotificationPreferences {
    const normalized: NotificationPreferences = {
      globalEmailUnsubscribed: !!prefs.globalEmailUnsubscribed,
      outbid: { ...DEFAULT_CHANNEL_PREF, ...prefs.outbid },
      auctionEndingSoon: { ...DEFAULT_CHANNEL_PREF, ...prefs.auctionEndingSoon },
      auctionWon: { ...DEFAULT_CHANNEL_PREF, ...prefs.auctionWon },
      offerReceived: { ...DEFAULT_CHANNEL_PREF, ...prefs.offerReceived },
      offerAccepted: { ...DEFAULT_CHANNEL_PREF, ...prefs.offerAccepted },
      dispatch: { ...DEFAULT_CHANNEL_PREF, ...prefs.dispatch },
      paymentReceived: { ...DEFAULT_CHANNEL_PREF, ...prefs.paymentReceived },
      newBid: { ...DEFAULT_CHANNEL_PREF, ...prefs.newBid },
      disputeUpdate: { ...DEFAULT_CHANNEL_PREF, ...prefs.disputeUpdate },
    };
    return normalized;
  }

  getEventPref(key: string): { email: boolean; push: boolean; inApp: boolean } {
    if (!this.notifPrefs) return { ...DEFAULT_CHANNEL_PREF };
    const pref = (this.notifPrefs as any)[key] ?? { ...DEFAULT_CHANNEL_PREF };
    if (this.notifPrefs.globalEmailUnsubscribed) {
      return { ...pref, email: false, inApp: false };
    }
    return pref;
  }

  toggleGlobalUnsubscribe(): void {
    if (!this.notifPrefs) return;
    const next = !this.notifPrefs.globalEmailUnsubscribed;
    this.notifPrefs.globalEmailUnsubscribed = next;
    if (next) {
      for (const key of this.notifEventKeys) {
        const pref = (this.notifPrefs as any)[key] ?? { ...DEFAULT_CHANNEL_PREF };
        (this.notifPrefs as any)[key] = { ...pref, email: false, inApp: false };
      }
    }
  }

  toggleEventChannel(key: string, channel: 'email' | 'push' | 'inApp'): void {
    if (!this.notifPrefs || this.notifPrefs.globalEmailUnsubscribed) return;
    const pref = (this.notifPrefs as any)[key] ?? { ...DEFAULT_CHANNEL_PREF };
    (this.notifPrefs as any)[key] = { ...pref, [channel]: !pref[channel] };
  }

  saveNotifPrefs(): void {
    if (!this.notifPrefs) return;
    this.notifPrefsSaving = true;
    this.notifPrefsError = null;
    this.notifPrefsService.updatePreferences(this.notifPrefs).subscribe({
      next: (saved) => {
        this.notifPrefs = saved;
        this.notifPrefsSaving = false;
        this.notifPrefsSaved = true;
        setTimeout(() => this.notifPrefsSaved = false, 2500);
      },
      error: () => {
        this.notifPrefsSaving = false;
        this.notifPrefsError = this.translate.instant('dashboard.settings.savePrefsError');
      }
    });
  }

  get connectStatusLabel(): string {
    if (!this.connectStatus?.connected) return this.translate.instant('dashboard.settings.connectNotConnected');
    if (this.connectStatus.onboarded) return this.translate.instant('dashboard.settings.connectActive');
    return this.translate.instant('dashboard.settings.connectPending');
  }

  get connectStatusClass(): string {
    if (!this.connectStatus?.connected) return 'connect-not-connected';
    if (this.connectStatus.onboarded) return 'connect-active';
    return 'connect-pending';
  }

  applySellerComplianceFromProfile(c: SellerCompliance | null): void {
    if (!c) {
      this.sellerComplianceAvailable = false;
      this.sellerClassification = 'private';
      this.professionalVerificationStatus = 'none';
      this.professionalSubmittedAt = null;
      this.professionalVerifiedAt = null;
      this.professionalRejectionNote = null;
      return;
    }
    this.sellerComplianceAvailable = true;
    this.sellerClassification = c.sellerClassification === 'professional' ? 'professional' : 'private';
    this.professionalLegalName = c.professionalLegalName ?? '';
    this.professionalTradeName = c.professionalTradeName ?? '';
    this.professionalAddressLine1 = c.professionalAddressLine1 ?? '';
    this.professionalAddressLine2 = c.professionalAddressLine2 ?? '';
    this.professionalCity = c.professionalCity ?? '';
    this.professionalRegion = c.professionalRegion ?? '';
    this.professionalPostalCode = c.professionalPostalCode ?? '';
    this.professionalCountry = (c.professionalCountry ?? 'PT').toUpperCase().slice(0, 2) || 'PT';
    this.professionalContactPhone = c.professionalContactPhone ?? '';
    this.professionalContactEmail = c.professionalContactEmail ?? '';
    this.professionalVatId = c.professionalVatId ?? '';
    this.professionalVerificationStatus = c.professionalVerificationStatus ?? 'none';
    this.professionalSubmittedAt = c.professionalSubmittedAt ?? null;
    this.professionalVerifiedAt = c.professionalVerifiedAt ?? null;
    this.professionalRejectionNote = c.professionalRejectionNote ?? null;
  }

  reloadSellerCompliance(): void {
    this.customerService.getCustomer().subscribe({
      next: (info) => this.applySellerComplianceFromProfile(info.sellerCompliance ?? null)
    });
  }

  saveSellerCompliance(): void {
    this.dsaError = null;
    if (!this.sellerComplianceAvailable) {
      this.dsaError = this.translate.instant('dashboard.settings.dsa.unavailable');
      return;
    }
    const payload: {
      sellerClassification: 'private' | 'professional';
      professionalLegalName?: string;
      professionalTradeName?: string;
      professionalAddressLine1?: string;
      professionalAddressLine2?: string;
      professionalCity?: string;
      professionalRegion?: string;
      professionalPostalCode?: string;
      professionalCountry?: string;
      professionalContactPhone?: string;
      professionalContactEmail?: string;
      professionalVatId?: string;
    } = { sellerClassification: this.sellerClassification };
    if (this.sellerClassification === 'professional') {
      const legal = this.professionalLegalName.trim();
      const line1 = this.professionalAddressLine1.trim();
      const city = this.professionalCity.trim();
      const region = this.professionalRegion.trim();
      const postal = this.professionalPostalCode.trim();
      const country = this.professionalCountry.trim().toUpperCase();
      const phone = this.professionalContactPhone.trim();
      const email = this.professionalContactEmail.trim();
      const vat = this.professionalVatId.trim();
      if (!legal || !line1 || !city || !region || !postal || !country || !phone || !email || !vat) {
        this.dsaError = this.translate.instant('dashboard.settings.dsa.validationRequired');
        return;
      }
      if (!/^[A-Z]{2}$/.test(country)) {
        this.dsaError = this.translate.instant('dashboard.settings.dsa.invalidCountry');
        return;
      }
      payload.professionalLegalName = legal;
      payload.professionalTradeName = this.professionalTradeName.trim() || '';
      payload.professionalAddressLine1 = line1;
      payload.professionalAddressLine2 = this.professionalAddressLine2.trim() || '';
      payload.professionalCity = city;
      payload.professionalRegion = region;
      payload.professionalPostalCode = postal;
      payload.professionalCountry = country;
      payload.professionalContactPhone = phone;
      payload.professionalContactEmail = email;
      payload.professionalVatId = vat;
    }
    this.dsaSaving = true;
    this.customerService.updateSellerCompliance(payload).subscribe({
      next: () => {
        this.dsaSaving = false;
        this.dsaSaved = true;
        setTimeout(() => (this.dsaSaved = false), 3000);
        this.reloadSellerCompliance();
      },
      error: (err) => {
        this.dsaSaving = false;
        this.dsaError =
          err?.error?.message || err?.error?.error || this.translate.instant('dashboard.settings.dsa.saveFailed');
      }
    });
  }
}
