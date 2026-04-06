import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { CustomerService } from '../../../shared/services/customer.service';
import { MangopayService, MangoPaySellerStatus, MangoPaySetupData } from '../../../shared/services/mangopay.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-dashboard-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './dashboard-settings.component.html',
  styleUrls: ['./dashboard-settings.component.scss']
})
export class DashboardSettingsComponent implements OnInit {
  private authService = inject(AuthService);
  private customerService = inject(CustomerService);
  private translate = inject(TranslateService);
  private mangopay = inject(MangopayService);

  /** Display scale for buyer/seller review averages (matches 1–10 transaction reviews). */
  readonly reviewScoreMax = 10;

  currentUser$: Observable<AppUser | null>;
  buyerScore: number | null = null;
  sellerScore: number | null = null;
  buyerReviewCount = 0;
  sellerReviewCount = 0;

  sellerStatus: MangoPaySellerStatus | null = null;
  statusLoading = false;
  statusSubmitting = false;
  statusMessage: string | null = null;
  statusError: string | null = null;
  showOnboardingForm = false;

  // Onboarding form fields
  dobDay: number | null = null;
  dobMonth: number | null = null;
  dobYear: number | null = null;
  addressLine1 = '';
  addressCity = '';
  addressPostal = '';
  addressCountry = 'PT';
  iban = '';
  bic = '';
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
    { code: 'CH', label: 'Switzerland' }, { code: 'GB', label: 'United Kingdom' }
  ];

  selectedLanguage = 'en';
  langSaving = false;
  langSaved = false;

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
      }
    });

    this.loadSellerStatus();
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

  loadSellerStatus(): void {
    this.statusLoading = true;
    this.mangopay.getSellerStatus().subscribe({
      next: (s) => { this.sellerStatus = s; this.statusLoading = false; },
      error: () => { this.statusLoading = false; }
    });
  }

  openOnboardingForm(): void {
    this.statusError = null;
    this.showOnboardingForm = true;
  }

  cancelOnboardingForm(): void {
    this.showOnboardingForm = false;
    this.statusError = null;
  }

  submitOnboarding(): void {
    this.statusError = null;

    if (!this.dobDay || !this.dobMonth || !this.dobYear) {
      this.statusError = 'Please enter your date of birth.';
      return;
    }
    if (!this.addressLine1 || !this.addressCity || !this.addressPostal || !this.addressCountry) {
      this.statusError = 'Please fill in your full address.';
      return;
    }
    if (!this.iban.trim()) {
      this.statusError = 'Please enter your IBAN.';
      return;
    }
    if (!this.tosAccepted) {
      this.statusError = 'You must accept the Terms of Service.';
      return;
    }

    const data: MangoPaySetupData = {
      dobDay: this.dobDay,
      dobMonth: this.dobMonth,
      dobYear: this.dobYear,
      addressLine1: this.addressLine1,
      addressCity: this.addressCity,
      addressPostal: this.addressPostal,
      addressCountry: this.addressCountry,
      iban: this.iban,
      bic: this.bic || undefined
    };

    this.statusSubmitting = true;
    this.mangopay.setupSeller(data).subscribe({
      next: (res) => {
        this.statusSubmitting = false;
        this.showOnboardingForm = false;
        this.statusMessage = res.mangoPayOnboarded
          ? 'Your payout account is now active!'
          : 'Your bank account has been registered. Funds will be paid out after each transaction.';
        this.loadSellerStatus();
      },
      error: (err) => {
        this.statusSubmitting = false;
        this.statusError = err?.error?.message || err?.error?.error || 'Something went wrong. Please check your details and try again.';
      }
    });
  }

  get payoutStatusLabel(): string {
    if (!this.sellerStatus?.mangoPayOnboarded) return 'Not set up';
    const level = this.sellerStatus.mangoPayKycLevel;
    return level === 'REGULAR' ? 'Active (Verified)' : 'Active (Basic)';
  }

  get payoutStatusClass(): string {
    if (!this.sellerStatus?.mangoPayOnboarded) return 'connect-not-connected';
    return 'connect-active';
  }
}
