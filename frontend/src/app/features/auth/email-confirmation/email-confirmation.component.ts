import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { Logger } from '@core/services/logger.service';

@Component({
  selector: 'app-email-confirmation',
  templateUrl: './email-confirmation.component.html',
  styleUrls: ['./email-confirmation.component.scss']
})
export class EmailConfirmationComponent implements OnInit {
  isLoading = false;
  isConfirmed = false;
  errorMessage = '';
  successMessage = '';
  email = '';
  confirmationToken = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private logger: Logger
  ) {}

  ngOnInit(): void {
    // Get token from URL parameters
    this.route.queryParams.subscribe(params => {
      this.confirmationToken = params['token'];
      this.email = params['email'];
      
      if (this.confirmationToken) {
        this.confirmEmail();
      }
    });
  }

  confirmEmail(): void {
    if (!this.confirmationToken) {
      this.errorMessage = 'No confirmation token provided';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.confirmEmail(this.confirmationToken).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success) {
          this.isConfirmed = true;
          this.successMessage = response.message;
          
          // Redirect to dashboard after successful confirmation
          setTimeout(() => {
            this.router.navigate(['/dashboard']);
          }, 3000);
        }
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || 'Email confirmation failed. Please try again.';
        this.logger.error('Email confirmation failed:', error);
      }
    });
  }

  resendConfirmation(): void {
    if (!this.email) {
      this.errorMessage = 'Email address is required';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.resendConfirmationEmail(this.email).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success) {
          this.successMessage = response.message;
        }
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || 'Failed to resend confirmation email. Please try again.';
        this.logger.error('Failed to resend confirmation email:', error);
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
