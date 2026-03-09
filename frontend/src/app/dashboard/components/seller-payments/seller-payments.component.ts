import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { PaymentService, ConnectAccountStatus } from '../../../shared/services/payment.service';

@Component({
  selector: 'app-seller-payments',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './seller-payments.component.html',
  styleUrls: ['./seller-payments.component.scss']
})
export class SellerPaymentsComponent implements OnInit {
  accountStatus: ConnectAccountStatus | null = null;
  isLoading = true;
  isConnecting = false;
  error: string | null = null;
  successMessage: string | null = null;

  constructor(
    private paymentService: PaymentService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Handle return from Stripe onboarding
    const setup = this.route.snapshot.queryParamMap.get('setup');
    if (setup === 'complete') {
      this.successMessage = 'Stripe account setup complete! You can now receive payments.';
    } else if (setup === 'refresh') {
      this.successMessage = null;
    }
    this.loadStatus();
  }

  loadStatus(): void {
    this.isLoading = true;
    this.paymentService.getConnectStatus().subscribe({
      next: (status) => {
        this.accountStatus = status;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load account status';
        this.isLoading = false;
      }
    });
  }

  connectStripe(): void {
    this.isConnecting = true;
    this.error = null;

    this.paymentService.createConnectAccount().subscribe({
      next: () => {
        // Now get the onboarding link
        this.getOnboardingLink();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to create Stripe account';
        this.isConnecting = false;
      }
    });
  }

  openOnboardingLink(): void {
    this.isConnecting = true;
    this.error = null;
    this.getOnboardingLink();
  }

  private getOnboardingLink(): void {
    this.paymentService.getConnectAccountLink().subscribe({
      next: (res) => {
        window.location.href = res.url;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to get onboarding link';
        this.isConnecting = false;
      }
    });
  }
}
