import { Component, OnInit, computed, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../services/auth.service';
import { UserRolesService } from '../../../shared/services/user-roles.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { BidroomLogoComponent } from '../../../shared/components/bidroom-logo/bidroom-logo.component';
import { AnalyticsService } from '../../../shared/services/analytics.service';
import { AnalyticsEvents } from '../../../shared/services/analytics.events';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, RouterLink, BidroomLogoComponent],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private userRoles = inject(UserRolesService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);
  private themeService = inject(ThemeService);
  private analytics = inject(AnalyticsService);

  readonly isLight = computed(() => this.themeService.effective() === 'light');

  loginForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  returnUrl = '';
  showPassword = false;
  /** Drives CTA buttons under the error banner (locale-independent). */
  errorAction: 'not-found' | 'wrong-password' | 'not-verified' | null = null;

  constructor() {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    // Get return url from route parameters or default to dashboard home
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard/home';

    const prefill = this.route.snapshot.queryParams['email'];
    if (prefill) {
      this.loginForm.patchValue({ email: String(prefill).trim().toLowerCase() });
    }

    // Check if redirected here due to unverified email
    if (this.route.snapshot.queryParams['verifyEmail'] === 'true') {
      this.errorMessage = this.translate.instant('auth.login.verifyEmailRequired');
      this.errorAction = 'not-verified';
    }
  }

  onSubmit(): void {
    if (this.isLoading) return;
    this.errorMessage = '';
    this.errorAction = null;

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const email = String(this.loginForm.value.email || '').trim().toLowerCase();

    this.authService.login(email, this.loginForm.value.password).subscribe({
      next: () => {
        this.analytics.trackEvent(AnalyticsEvents.LOGIN, { method: 'email' });
        this.isLoading = false;
        this.routeAfterLogin();
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = this.getErrorMessage(error);
        this.errorAction = this.getErrorAction(error);
      }
    });
  }

  loginWithGoogle(): void {
    if (this.isLoading) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.errorAction = null;
    this.authService.loginWithGoogle().subscribe({
      next: () => {
        this.analytics.trackEvent(AnalyticsEvents.LOGIN, { method: 'google' });
        this.isLoading = false;
        this.routeAfterLogin();
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = this.getErrorMessage(error);
      }
    });
  }

  /**
   * After a successful sign-in, ask the backend whether the user is an admin
   * (the email allow-list lives server-side and is not exposed to the bundle).
   * Admins with a previously-saved /nexus route are bounced back to it.
   */
  private routeAfterLogin(): void {
    this.userRoles.load().subscribe((roles) => {
      const adminRoute = localStorage.getItem('admin_route');
      if (roles.isAdmin && adminRoute) {
        this.router.navigate([adminRoute]);
      } else {
        this.router.navigate([this.returnUrl]);
      }
    });
  }

  navigateToSignup(): void {
    this.router.navigate(['/auth/signup']);
  }

  navigateToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-password'], {
      queryParams: this.loginForm.value.email
        ? { email: String(this.loginForm.value.email).trim().toLowerCase() }
        : undefined
    });
  }

  navigateToCheckEmail(): void {
    this.router.navigate(['/auth/check-email'], {
      queryParams: {
        email: String(this.loginForm.value.email || '').trim().toLowerCase()
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  getFieldError(fieldName: string): string {
    const field = this.loginForm.get(fieldName);
    if (field?.errors && field.touched) {
      if (field.errors['required']) {
        return this.translate.instant('auth.errors.fieldRequired', { field: this.translate.instant('auth.common.' + fieldName) });
      }
      if (field.errors['email']) {
        return this.translate.instant('auth.errors.invalidEmail');
      }
    }
    return '';
  }

  getErrorAction(error: { code?: string }): 'not-found' | 'wrong-password' | 'not-verified' | null {
    switch (error?.code) {
      case 'auth/user-not-found':
        return 'not-found';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'wrong-password';
      case 'auth/email-not-verified':
        return 'not-verified';
      default:
        return null;
    }
  }

  getErrorMessage(error: { code?: string; message?: string }): string {
    const errorCode = error?.code || '';

    switch (errorCode) {
      case 'auth/user-not-found':
        return this.translate.instant('auth.errors.userNotFound');
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return this.translate.instant('auth.errors.wrongPasswordHint');
      case 'auth/email-not-verified':
        return this.translate.instant('auth.login.verifyEmailRequired');
      case 'auth/invalid-email':
        return this.translate.instant('auth.errors.invalidEmail');
      case 'auth/user-disabled':
        return this.translate.instant('auth.errors.userDisabled');
      case 'auth/too-many-requests':
        return this.translate.instant('auth.errors.tooManyRequests');
      case 'auth/operation-not-allowed':
        return this.translate.instant('auth.errors.operationNotAllowed');
      case 'auth/popup-closed-by-user':
        return this.translate.instant('auth.errors.popupClosed');
      case 'auth/cancelled-popup-request':
        return this.translate.instant('auth.errors.popupCancelled');
      case 'auth/popup-blocked':
        return this.translate.instant('auth.errors.popupBlocked');
      default:
        return error?.message || this.translate.instant('auth.errors.loginFailed');
    }
  }
}
