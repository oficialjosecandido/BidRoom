import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { Auth, applyActionCode } from '@angular/fire/auth';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './verify-email.component.html',
  styleUrls: ['./verify-email.component.scss']
})
export class VerifyEmailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(Auth);

  isLoading = true;
  isVerified = false;
  errorMessage = '';
  code = '';

  ngOnInit(): void {
    // Get oobCode from query parameters (Firebase email verification)
    this.route.queryParams.subscribe(params => {
      this.code = params['oobCode'];
      if (this.code) {
        this.verifyEmail();
      } else {
        this.errorMessage = 'Invalid or missing verification code.';
        this.isLoading = false;
      }
    });
  }

  verifyEmail(): void {
    applyActionCode(this.auth, this.code)
      .then(() => {
        this.isLoading = false;
        this.isVerified = true;
      })
      .catch((error: any) => {
        this.isLoading = false;
        this.errorMessage = error?.message || 'Email verification failed.';
      });
  }

  navigateToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
