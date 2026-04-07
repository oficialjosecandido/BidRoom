import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { CustomerService } from '../../../shared/services/customer.service';
import { AirwallexService } from '../../../shared/services/airwallex.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-my-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './my-account.component.html',
  styleUrls: ['./my-account.component.scss']
})
export class MyAccountComponent implements OnInit {
  private authService = inject(AuthService);
  private customerService = inject(CustomerService);
  private airwallexService = inject(AirwallexService);
  private route = inject(ActivatedRoute);

  currentUser$: Observable<AppUser | null>;
  buyerScore: number | null = null;
  sellerScore: number | null = null;
  buyerReviewCount = 0;
  sellerReviewCount = 0;

  kycStatus: 'pending' | 'in_review' | 'approved' | 'failed' | null = null;
  kycOnboarded = false;
  kycLoading = false;
  kycError: string | null = null;
  kycStatusMessage: string | null = null;

  constructor() {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    this.customerService.getCustomer().subscribe({
      next: (info) => {
        this.buyerScore = info.buyerScore ?? null;
        this.sellerScore = info.sellerScore ?? null;
        this.buyerReviewCount = info.buyerReviewCount ?? 0;
        this.sellerReviewCount = info.sellerReviewCount ?? 0;
        this.kycOnboarded = info.airwallexOnboarded;
        this.kycStatus = info.airwallexKycStatus;
      }
    });
  }

  startKyc(): void {
    this.kycError = null;
    this.kycLoading = true;
    this.airwallexService.onboard().subscribe({
      next: (status) => {
        this.kycOnboarded = status.onboarded;
        this.kycStatus = status.kycStatus;
        this.kycLoading = false;
        if (status.onboarded) {
          this.kycStatusMessage = 'Your payout account is active.';
        } else {
          this.kycStatusMessage = 'Account created. Please complete verification in Settings → Payout Account.';
        }
      },
      error: (err) => {
        this.kycLoading = false;
        this.kycError = err?.error?.message || 'Failed to set up payout account. Please try again.';
      }
    });
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
