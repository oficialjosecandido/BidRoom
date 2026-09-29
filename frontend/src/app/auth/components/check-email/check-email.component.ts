import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-check-email',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './check-email.component.html',
  styleUrls: ['./check-email.component.scss']
})
export class CheckEmailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);

  email = '';
  resending = false;
  resendMessage = '';
  resendError = '';

  constructor() {
    this.email = (this.route.snapshot.queryParams['email'] || '').trim().toLowerCase();
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login'], {
      queryParams: this.email ? { email: this.email } : undefined
    });
  }

  resend(): void {
    if (!this.email || this.resending) return;
    this.resending = true;
    this.resendMessage = '';
    this.resendError = '';
    this.authService.resendVerificationEmail(this.email).subscribe({
      next: (res) => {
        this.resending = false;
        this.resendMessage = res?.alreadyVerified
          ? this.translate.instant('auth.checkEmail.alreadyVerified')
          : this.translate.instant('auth.checkEmail.resent');
      },
      error: () => {
        this.resending = false;
        this.resendError = this.translate.instant('auth.checkEmail.resendFailed');
      }
    });
  }
}
