import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { Auth, applyActionCode } from '@angular/fire/auth';
import { PostHogService } from '../../../shared/services/posthog.service';
import { AnalyticsEvents } from '../../../shared/services/analytics.events';

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
  private translate = inject(TranslateService);
  private postHog = inject(PostHogService);
  private destroyRef = inject(DestroyRef);

  isLoading = true;
  isVerified = false;
  errorMessage = '';
  code = '';

  ngOnInit(): void {
    // Get oobCode from query parameters (Firebase email verification)
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.code = params['oobCode'];
      if (this.code) {
        this.verifyEmail();
      } else {
        this.errorMessage = this.translate.instant('auth.verifyEmail.invalidCode');
        this.isLoading = false;
      }
    });
  }

  verifyEmail(): void {
    applyActionCode(this.auth, this.code)
      .then(() => {
        this.isLoading = false;
        this.isVerified = true;
        this.postHog.track(AnalyticsEvents.EMAIL_VERIFIED);
      })
      .catch((error: any) => {
        this.isLoading = false;
        this.errorMessage = error?.message || this.translate.instant('auth.verifyEmail.failedGeneric');
      });
  }

  navigateToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
