import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { AuthenticationResult } from '@azure/msal-browser';
import { AuthService } from '@core/services/auth.service';
import { Logger } from '@core/services/logger.service';

@Component({
  selector: 'app-callback',
  template: `
    <div class="callback-container">
      <div class="callback-card">
        <div class="loading-spinner">
          <div class="spinner"></div>
        </div>
        <h2>Completing sign in...</h2>
        <p>Please wait while we finish setting up your account.</p>
      </div>
    </div>
  `,
  styles: [`
    .callback-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--primary-light) 0%, var(--primary-color) 100%);
      padding: 2rem;
    }

    .callback-card {
      background: white;
      border-radius: 16px;
      padding: 3rem;
      box-shadow: var(--shadow-lg);
      text-align: center;
      max-width: 400px;
      width: 100%;

      .loading-spinner {
        margin-bottom: 2rem;

        .spinner {
          width: 60px;
          height: 60px;
          border: 4px solid var(--gray-200);
          border-top: 4px solid var(--primary-color);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        }
      }

      h2 {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--gray-800);
        margin-bottom: 1rem;
      }

      p {
        color: var(--gray-600);
        line-height: 1.5;
      }
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `]
})
export class CallbackComponent implements OnInit {
  constructor(
    private msalService: MsalService,
    private authService: AuthService,
    private router: Router,
    private logger: Logger
  ) {}

  ngOnInit(): void {
    this.handleCallback();
  }

  private handleCallback(): void {
    this.msalService.instance.handleRedirectPromise().then((response: AuthenticationResult | null) => {
      if (response) {
        this.logger.info('Callback response received:', response);
        
        // Set the active account
        this.msalService.instance.setActiveAccount(response.account);
        
        // Redirect to dashboard or stored URL
        this.redirectAfterLogin();
      } else {
        this.logger.error('No callback response received');
        this.router.navigate(['/auth/login']);
      }
    }).catch((error) => {
      this.logger.error('Callback error:', error);
      this.router.navigate(['/auth/login']);
    });
  }

  private redirectAfterLogin(): void {
    const redirectUrl = sessionStorage.getItem('redirectUrl');
    
    if (redirectUrl && redirectUrl !== '/auth/callback') {
      sessionStorage.removeItem('redirectUrl');
      this.router.navigateByUrl(redirectUrl);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
