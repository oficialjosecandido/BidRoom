import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { CustomerService, AppealRecord } from '../../../shared/services/customer.service';
import { StripeConnectService, ConnectAccountStatus, OnboardingFormData } from '../../../shared/services/stripe-connect.service';
import { KycService, KycStatus, KycStatusResponse } from '../../../shared/services/kyc.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-my-account',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './my-account.component.html',
  styleUrls: ['./my-account.component.scss']
})
export class MyAccountComponent implements OnInit {
  private authService = inject(AuthService);
  private customerService = inject(CustomerService);
  private stripeConnect = inject(StripeConnectService);
  private kycService = inject(KycService);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);
  private destroyRef = inject(DestroyRef);

  currentUser$: Observable<AppUser | null>;

  // Restriction / appeal state
  contentRestrictedUntil: string | null = null;
  accountStatus = 'active';
  existingAppeal: AppealRecord | null = null;
  appealMessage = '';
  appealSubmitting = false;
  appealError = '';
  appealSuccess = false;

  kycStatusData: KycStatusResponse | null = null;
  kycLoading = false;
  kycReturnBanner = false;

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

  constructor() {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    this.customerService.getCustomer().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (info) => {
        this.buyerScore = info.buyerScore ?? null;
        this.sellerScore = info.sellerScore ?? null;
        this.buyerReviewCount = info.buyerReviewCount ?? 0;
        this.sellerReviewCount = info.sellerReviewCount ?? 0;
        this.accountStatus = info.user.accountStatus ?? 'active';
        this.contentRestrictedUntil = (info.user as any).contentRestrictedUntil ?? null;
      }
    });

    this.customerService.getMyAppeal().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.existingAppeal = res.appeal;
        if (!this.contentRestrictedUntil) this.contentRestrictedUntil = res.contentRestrictedUntil;
        if (this.accountStatus === 'active') this.accountStatus = res.accountStatus;
      },
      error: () => {}
    });

    this.loadConnectStatus();
    this.loadKycStatus();

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      if (params['kyc_return'] === '1') {
        this.kycReturnBanner = true;
      }
    });
  }

  loadKycStatus(): void {
    this.kycLoading = true;
    this.kycService.fetchStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => { this.kycStatusData = data; this.kycLoading = false; },
      error: () => { this.kycLoading = false; }
    });
  }

  startKycVerification(): void {
    this.kycService.startVerification();
  }

  get kycStatusLabel(): string {
    const s: KycStatus = this.kycStatusData?.kycStatus ?? 'none';
    const map: Record<KycStatus, string> = {
      none: 'Not verified',
      pending: 'Pending review',
      approved: 'Verified',
      rejected: 'Not approved'
    };
    return map[s];
  }

  get kycStatusClass(): string {
    const s: KycStatus = this.kycStatusData?.kycStatus ?? 'none';
    return `kyc-${s}`;
  }

  loadConnectStatus(): void {
    this.connectLoading = true;
    this.stripeConnect.getAccountStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.stripeConnect.submitOnboarding(data).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.connectSubmitting = false;
        this.showOnboardingForm = false;
        this.connectStatusMessage = res.onboarded
          ? this.translate.instant('dashboard.myAccount.payoutNowActive')
          : this.translate.instant('dashboard.myAccount.detailsSubmitted');
        this.loadConnectStatus();
      },
      error: (err) => {
        this.connectSubmitting = false;
        this.connectError = err?.error?.message || err?.error?.error || this.translate.instant('dashboard.myAccount.connectError');
      }
    });
  }

  get connectStatusLabel(): string {
    if (!this.connectStatus?.connected) return this.translate.instant('dashboard.myAccount.connectNotConnected');
    if (this.connectStatus.onboarded) return this.translate.instant('dashboard.myAccount.connectActive');
    return this.translate.instant('dashboard.myAccount.connectPending');
  }

  get connectStatusClass(): string {
    if (!this.connectStatus?.connected) return 'connect-not-connected';
    if (this.connectStatus.onboarded) return 'connect-active';
    return 'connect-pending';
  }

  testActivate(): void {
    this.connectTestActivating = true;
    this.stripeConnect.testActivate().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.connectTestActivating = false;
        this.connectStatusMessage = 'Test account activated!';
        this.loadConnectStatus();
      },
      error: (err) => {
        this.connectTestActivating = false;
        this.connectError = err?.error?.error || 'Test activation failed.';
      }
    });
  }

  get isContentRestricted(): boolean {
    return !!(this.contentRestrictedUntil && new Date(this.contentRestrictedUntil) > new Date());
  }

  get restrictedUntilDate(): string {
    if (!this.contentRestrictedUntil) return '';
    return new Date(this.contentRestrictedUntil).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  get hasPendingAppeal(): boolean {
    return this.existingAppeal?.status === 'pending';
  }

  submitAppeal(): void {
    if (this.appealSubmitting || !this.appealMessage.trim()) return;
    this.appealSubmitting = true;
    this.appealError = '';
    this.customerService.submitAppeal(this.appealMessage.trim()).subscribe({
      next: ({ appeal }) => {
        this.existingAppeal = appeal;
        this.appealSuccess = true;
        this.appealSubmitting = false;
        this.appealMessage = '';
      },
      error: (err) => {
        this.appealError = err?.error?.message || 'Não foi possível enviar o pedido. Tente novamente.';
        this.appealSubmitting = false;
      }
    });
  }
}
