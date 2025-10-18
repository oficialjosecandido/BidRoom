import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, User } from '@core/services/auth.service';
import { Logger } from '@core/services/logger.service';

@Component({
  selector: 'app-verify-bidding',
  templateUrl: './verify-bidding.component.html',
  styleUrls: ['./verify-bidding.component.scss']
})
export class VerifyBiddingComponent implements OnInit {
  currentUser: User | null = null;
  isLoading = true;

  constructor(
    private authService: AuthService,
    public router: Router,
    private logger: Logger
  ) {}

  ngOnInit(): void {
    this.loadCurrentUser();
  }

  private loadCurrentUser(): void {
    this.authService.getCurrentUser().subscribe({
      next: (user) => {
        this.currentUser = user;
        this.isLoading = false;

        // If user already has bidding privileges, redirect to dashboard
        if (user?.biddingStatus.isActive) {
          this.router.navigate(['/dashboard']);
        }
      },
      error: (error) => {
        this.logger.error('Failed to load user:', error);
        this.router.navigate(['/auth/login']);
      }
    });
  }

  startVerification(): void {
    this.router.navigate(['/auth/pre-auth']);
  }

  getBiddingStatusMessage(): string {
    if (!this.currentUser) return '';

    const status = this.currentUser.biddingStatus;
    
    if (!status.isActive) {
      return 'Your bidding account needs verification to participate in auctions.';
    }

    if (status.tier === 'basic') {
      return 'You have basic access. Upgrade to verified tier for full bidding privileges.';
    }

    if (status.tier === 'verified' && status.preAuthAmount && status.preAuthAmount > 0) {
      return 'Your account is verified and ready for bidding!';
    }

    return 'Please complete payment verification to start bidding.';
  }

  getTierBenefits(): string[] {
    const benefits = [
      'Bid on any auction',
      'Create your own listings',
      'Access to private auction rooms',
      'Priority customer support',
      'Advanced bidding analytics'
    ];

    return benefits;
  }

  getRequirementSteps(): Array<{step: number, title: string, description: string}> {
    return [
      {
        step: 1,
        title: 'Choose Verification Level',
        description: 'Select the bidding tier that matches your needs'
      },
      {
        step: 2,
        title: 'Payment Method Verification',
        description: 'Add a valid credit card for pre-authorization'
      },
      {
        step: 3,
        title: 'Account Activation',
        description: 'Start bidding on auctions immediately'
      }
    ];
  }
}
