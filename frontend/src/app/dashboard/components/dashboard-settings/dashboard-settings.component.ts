import { Component, OnInit, OnDestroy, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { CustomerService } from '../../../shared/services/customer.service';
import { AirwallexService } from '../../../shared/services/airwallex.service';
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
  private airwallexService = inject(AirwallexService);

  @ViewChild('kycContainer', { static: false }) kycContainer!: ElementRef;

  readonly reviewScoreMax = 10;

  currentUser$: Observable<AppUser | null>;
  buyerScore: number | null = null;
  sellerScore: number | null = null;
  buyerReviewCount = 0;
  sellerReviewCount = 0;

  // Airwallex KYC state
  kycStatus: 'pending' | 'in_review' | 'approved' | 'failed' | null = null;
  kycOnboarded = false;
  kycLoading = false;
  kycWidgetOpen = false;
  kycError: string | null = null;
  kycStatusMessage: string | null = null;

  // Language
  selectedLanguage = 'en';
  langSaving = false;
  langSaved = false;

  readonly languages = [
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'pt', label: 'Português', flag: '🇵🇹' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'fr', label: 'Français', flag: '🇫🇷' }
  ];

  private kycElement: any = null;

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
        this.kycOnboarded = info.airwallexOnboarded;
        this.kycStatus = info.airwallexKycStatus;
        if (info.language) {
          this.selectedLanguage = info.language;
          this.translate.use(info.language);
          localStorage.setItem('lang', info.language);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.unmountKyc();
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

  startKyc(): void {
    this.kycError = null;
    this.kycLoading = true;

    // Step 1: create/fetch connected account
    this.airwallexService.onboard().subscribe({
      next: (status) => {
        this.kycOnboarded = status.onboarded;
        this.kycStatus = status.kycStatus;

        if (status.onboarded) {
          this.kycLoading = false;
          this.kycStatusMessage = 'Your payout account is already active!';
          return;
        }

        // Step 2: get KYC token and mount widget
        this.airwallexService.getKycToken().subscribe({
          next: (tokenData) => {
            this.kycLoading = false;
            if (tokenData.alreadyOnboarded) {
              this.kycOnboarded = true;
              this.kycStatus = 'approved';
              this.kycStatusMessage = 'Your payout account is active.';
              return;
            }
            this.kycWidgetOpen = true;
            setTimeout(() => this.mountKycWidget(tokenData.token, status.accountId!), 100);
          },
          error: (err) => {
            this.kycLoading = false;
            this.kycError = err?.error?.message || 'Failed to load KYC. Please try again.';
          }
        });
      },
      error: (err) => {
        this.kycLoading = false;
        this.kycError = err?.error?.message || 'Failed to set up payout account. Please try again.';
      }
    });
  }

  private async mountKycWidget(token: string, accountId: string): Promise<void> {
    try {
      const airwallexEnv = (window as any).__AIRWALLEX_ENV__ || 'demo';

      // Dynamically load the Airwallex Components SDK if not already loaded
      if (!(window as any).AirwallexComponentsSDK) {
        await this.loadScript('https://static.airwallex.com/components/sdk/v1/index.js');
      }

      const sdk = (window as any).AirwallexComponentsSDK;
      if (!sdk) {
        this.kycError = 'Payment SDK could not be loaded. Please refresh and try again.';
        return;
      }

      await sdk.init({
        env: airwallexEnv,
        authCode: token,
        clientId: accountId,
        langKey: this.translate.currentLang || 'en'
      });

      this.kycElement = sdk.createElement('kyc');
      this.kycElement.mount(this.kycContainer.nativeElement);

      // Listen for completion
      this.kycContainer.nativeElement.addEventListener('onKycSuccess', () => {
        this.kycWidgetOpen = false;
        this.kycStatus = 'in_review';
        this.kycStatusMessage = 'Your KYC has been submitted and is under review. You\'ll be notified once approved.';
        this.unmountKyc();
      });
    } catch (err: any) {
      this.kycError = 'Failed to load the KYC widget. Please refresh and try again.';
      console.error('[Airwallex KYC]', err);
    }
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  private unmountKyc(): void {
    if (this.kycElement) {
      try { this.kycElement.unmount(); } catch (_) {}
      this.kycElement = null;
    }
  }

  closeKycWidget(): void {
    this.kycWidgetOpen = false;
    this.unmountKyc();
  }

  get kycStatusLabel(): string {
    if (this.kycOnboarded) return 'Active';
    switch (this.kycStatus) {
      case 'in_review': return 'Under review';
      case 'failed': return 'Verification failed';
      case 'pending': return 'Not started';
      default: return 'Not connected';
    }
  }

  get kycStatusClass(): string {
    if (this.kycOnboarded) return 'connect-active';
    if (this.kycStatus === 'in_review') return 'connect-pending';
    if (this.kycStatus === 'failed') return 'connect-failed';
    return 'connect-not-connected';
  }
}
