import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { AuthService, AppUser } from '../../../auth/services/auth.service';
import { CustomerService } from '../../../shared/services/customer.service';
import { StripeConnectService, ConnectAccountStatus } from '../../../shared/services/stripe-connect.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-my-account',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './my-account.component.html',
  styleUrls: ['./my-account.component.scss']
})
export class MyAccountComponent implements OnInit {
  private authService = inject(AuthService);
  private customerService = inject(CustomerService);
  private stripeConnect = inject(StripeConnectService);
  private route = inject(ActivatedRoute);

  currentUser$: Observable<AppUser | null>;
  buyerScore: number | null = null;
  sellerScore: number | null = null;
  buyerReviewCount = 0;
  sellerReviewCount = 0;

  connectStatus: ConnectAccountStatus | null = null;
  connectLoading = false;
  connectOnboarding = false;
  connectStatusMessage: string | null = null;

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
      }
    });

    this.loadConnectStatus();

    // Handle return from Stripe onboarding
    this.route.queryParams.subscribe(params => {
      if (params['stripe_onboard'] === 'complete') {
        this.connectStatusMessage = 'Stripe onboarding complete! Your account is being verified — this may take a moment.';
        this.loadConnectStatus();
      } else if (params['stripe_onboard'] === 'refresh') {
        this.connectStatusMessage = 'Your onboarding session expired. Please try again.';
      }
    });
  }

  loadConnectStatus(): void {
    this.connectLoading = true;
    this.stripeConnect.getAccountStatus().subscribe({
      next: (status) => {
        this.connectStatus = status;
        this.connectLoading = false;
      },
      error: () => {
        this.connectLoading = false;
      }
    });
  }

  startOnboarding(): void {
    this.connectOnboarding = true;
    this.stripeConnect.startOnboarding().subscribe({
      next: (res) => {
        window.location.href = res.url;
      },
      error: () => {
        this.connectOnboarding = false;
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
