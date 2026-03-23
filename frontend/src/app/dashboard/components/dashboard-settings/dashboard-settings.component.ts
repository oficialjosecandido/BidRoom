import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { CustomerService } from '../../../shared/services/customer.service';
import { StripeConnectService, ConnectAccountStatus, OnboardingFormData } from '../../../shared/services/stripe-connect.service';
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
  private stripeConnect = inject(StripeConnectService);

  currentUser$: Observable<AppUser | null>;
  buyerScore: number | null = null;
  sellerScore: number | null = null;
  buyerReviewCount = 0;
  sellerReviewCount = 0;

  connectStatus: ConnectAccountStatus | null = null;
  connectLoading = false;
  connectSubmitting = false;
  connectStatusMessage: string | null = null;
  connectError: string | null = null;
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

    this.loadConnectStatus();
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
          ? 'Your payout account is now active!'
          : 'Your details have been submitted. Stripe will verify them shortly — this usually takes a few minutes.';
        this.loadConnectStatus();
      },
      error: (err) => {
        this.connectSubmitting = false;
        this.connectError = err?.error?.message || err?.error?.error || 'Something went wrong. Please check your details and try again.';
      }
    });
  }

  get connectStatusLabel(): string {
    if (!this.connectStatus?.connected) return 'Not connected';
    if (this.connectStatus.onboarded) return 'Active';
    return 'Pending verification';
  }

  get connectStatusClass(): string {
    if (!this.connectStatus?.connected) return 'connect-not-connected';
    if (this.connectStatus.onboarded) return 'connect-active';
    return 'connect-pending';
  }
}
