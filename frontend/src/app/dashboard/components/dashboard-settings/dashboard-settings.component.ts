import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { CustomerService, SellerCompliance } from '../../../shared/services/customer.service';
import { ThemePreference, ThemeService } from '../../../shared/services/theme.service';
import { StripeConnectService, ConnectAccountStatus, OnboardingFormData } from '../../../shared/services/stripe-connect.service';
import { NotificationPreferencesService, NotificationPreferences, NOTIFICATION_EVENT_KEYS, DEFAULT_CHANNEL_PREF } from '../../../shared/services/notification-preferences.service';
import { BuyerPaymentService, PaymentMethodResponse } from '../../../shared/services/buyer-payment.service';
import { loadStripe, Stripe, StripeElements, StripeCardElement } from '@stripe/stripe-js';
import { Observable } from 'rxjs';

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

  /** Display scale for buyer/seller review averages (matches 1–10 transaction reviews). */
  readonly reviewScoreMax = 10;

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

  // Onboarding form fields
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
  savedPaymentMethod: PaymentMethodResponse | null = null;
  loadingPaymentMethod = true;
  showAddCard = false;
  savingCard = false;
  cardError: string | null = null;
  private stripe: Stripe | null = null;
  private stripeElements: StripeElements | null = null;
  private cardElement: StripeCardElement | null = null;

  readonly notifEventKeys = NOTIFICATION_EVENT_KEYS;
  notifPrefs: NotificationPreferences | null = null;
  notifPrefsLoading = false;
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
  }

  ngOnDestroy(): void {
    this.cardElement?.destroy();
  }

  loadPaymentMethod(): void {
    this.buyerPaymentService.getPaymentMethod().subscribe({
      next: (pm) => { this.savedPaymentMethod = pm; this.loadingPaymentMethod = false; },
      error: () => { this.loadingPaymentMethod = false; }
    });
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
        const { error } = await this.stripe!.confirmCardSetup(res.clientSecret, {
          payment_method: { card: this.cardElement! }
        });
        if (error) {
          this.cardError = error.message ?? 'Erro ao guardar o cartão.';
          this.savingCard = false;
        } else {
          setTimeout(() => {
            this.showAddCard = false;
            this.savingCard = false;
            this.cardElement?.destroy();
            this.cardElement = null;
            this.loadPaymentMethod();
          }, 1500);
        }
      },
      error: () => {
        this.cardError = 'Erro ao iniciar o processo. Tenta novamente.';
        this.savingCard = false;
      }
    });
  }

  removeCard(): void {
    if (!confirm('Remover cartão guardado? O badge Pagamento Garantido será desactivado.')) return;
    this.buyerPaymentService.deletePaymentMethod().subscribe({
      next: () => this.loadPaymentMethod(),
      error: (err) => alert(err.error?.message ?? 'Erro ao remover o cartão.')
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
  }

  cancelOnboardingForm(): void {
    this.showOnboardingForm = false;
    this.connectError = null;
  }

  submitOnboarding(): void {
    this.connectError = null;
    if (!this.dobDay || !this.dobMonth || !this.dobYear) {
      this.connectError = 'Please enter your date of birth.';
      return;
    }
    if (!this.addressLine1 || !this.addressCity || !this.addressPostal || !this.addressCountry) {
      this.connectError = 'Please fill in your full address.';
      return;
    }
    if (!this.iban.trim()) {
      this.connectError = 'Please enter your IBAN.';
      return;
    }
    if (!this.tosAccepted) {
      this.connectError = 'You must accept the Terms of Service.';
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
    this.notifPrefsService.getPreferences().subscribe({
      next: (prefs) => { this.notifPrefs = prefs; this.notifPrefsLoading = false; },
      error: () => { this.notifPrefsLoading = false; }
    });
  }

  getEventPref(key: string): { email: boolean; push: boolean; inApp: boolean } {
    if (!this.notifPrefs) return { ...DEFAULT_CHANNEL_PREF };
    return (this.notifPrefs as any)[key] ?? { ...DEFAULT_CHANNEL_PREF };
  }

  toggleEventChannel(key: string, channel: 'email' | 'push' | 'inApp'): void {
    if (!this.notifPrefs) return;
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
