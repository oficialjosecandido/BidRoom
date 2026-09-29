import { Component, computed, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { BidroomLogoComponent } from '../../../shared/components/bidroom-logo/bidroom-logo.component';
import { AnalyticsService } from '../../../shared/services/analytics.service';
import { AnalyticsEvents } from '../../../shared/services/analytics.events';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslateModule, BidroomLogoComponent],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss']
})
export class SignupComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  private themeService = inject(ThemeService);
  private analytics = inject(AnalyticsService);

  readonly isLight = computed(() => this.themeService.effective() === 'light');

  signupForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  showPassword = false;
  showConfirmPassword = false;
  /** When set, show login / forgot / check-email CTAs under the error. */
  errorAction: 'email-exists' | null = null;

  constructor() {
    this.signupForm = this.fb.group({
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(12), this.strongPasswordValidator]],
      confirmPassword: ['', [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]]
    }, { validators: this.passwordMatchValidator });
  }

  get passwordValue(): string {
    return this.signupForm.get('password')?.value || '';
  }

  get passwordChecks(): { key: string; ok: boolean }[] {
    const p = this.passwordValue;
    return [
      { key: 'auth.signup.passwordRuleLength', ok: p.length >= 12 },
      { key: 'auth.signup.passwordRuleUpper', ok: /[A-Z]/.test(p) },
      { key: 'auth.signup.passwordRuleLower', ok: /[a-z]/.test(p) },
      { key: 'auth.signup.passwordRuleNumber', ok: /\d/.test(p) },
    ];
  }

  strongPasswordValidator(control: AbstractControl) {
    const password = control.value;
    if (!password) return null;

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasMinimumLength = password.length >= 12;

    const isValid = hasUpperCase && hasLowerCase && hasNumbers && hasMinimumLength;

    if (!isValid) {
      return { strongPassword: true };
    }
    return null;
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');

    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }

    if (confirmPassword?.hasError('passwordMismatch') && password?.value === confirmPassword?.value) {
      const { passwordMismatch: _, ...rest } = confirmPassword.errors || {};
      confirmPassword.setErrors(Object.keys(rest).length ? rest : null);
    }

    return null;
  }

  onSubmit(): void {
    if (this.isLoading) return;
    this.errorMessage = '';
    this.errorAction = null;

    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      this.errorMessage = this.translate.instant('auth.errors.fixIncomplete');
      return;
    }

    this.isLoading = true;
    this.successMessage = '';

    const displayName = `${this.signupForm.value.firstName} ${this.signupForm.value.lastName}`.trim();
    const email = String(this.signupForm.value.email || '').trim().toLowerCase();

    this.authService.register(email, this.signupForm.value.password, displayName).subscribe({
      next: () => {
        this.analytics.trackEvent(AnalyticsEvents.SIGN_UP, { method: 'email' });
        this.isLoading = false;
        this.router.navigate(['/auth/check-email'], {
          queryParams: { email }
        });
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = this.getErrorMessage(error);
        if (error?.code === 'auth/email-already-in-use') {
          this.errorAction = 'email-exists';
          this.signupForm.get('email')?.setErrors({ emailExists: true });
          this.signupForm.get('email')?.markAsTouched();
        }
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
        this.analytics.trackEvent(AnalyticsEvents.SIGN_UP, { method: 'google' });
        this.isLoading = false;
        this.router.navigate(['/dashboard/home']);
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = this.getErrorMessage(error);
      }
    });
  }

  navigateToLogin(): void {
    this.router.navigate(['/auth/login'], {
      queryParams: this.signupForm.value.email
        ? { email: String(this.signupForm.value.email).trim().toLowerCase() }
        : undefined
    });
  }

  navigateToCheckEmail(): void {
    this.router.navigate(['/auth/check-email'], {
      queryParams: { email: String(this.signupForm.value.email || '').trim().toLowerCase() }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  getFieldError(fieldName: string): string {
    const field = this.signupForm.get(fieldName);
    if (field?.errors && field.touched) {
      if (fieldName === 'acceptTerms' && field.errors['required']) {
        return this.translate.instant('auth.errors.mustAcceptTerms');
      }
      if (field.errors['required']) {
        return this.translate.instant('auth.errors.fieldRequired', { field: this.translate.instant('auth.signup.' + fieldName) });
      }
      if (field.errors['email']) {
        return this.translate.instant('auth.errors.invalidEmail');
      }
      if (field.errors['emailExists']) {
        return this.translate.instant('auth.errors.emailExists');
      }
      if (field.errors['minlength']) {
        return this.translate.instant('auth.errors.minLength', { field: this.translate.instant('auth.signup.' + fieldName), min: field.errors['minlength'].requiredLength });
      }
      if (field.errors['strongPassword']) {
        return this.translate.instant('auth.errors.weakPassword');
      }
      if (field.errors['passwordMismatch']) {
        return this.translate.instant('auth.errors.passwordMismatch');
      }
    }
    return '';
  }

  getErrorMessage(error: any): string {
    const errorCode = error?.code || '';

    switch (errorCode) {
      case 'auth/email-already-in-use':
        return this.translate.instant('auth.errors.emailAlreadyInUseHint');
      case 'auth/invalid-email':
        return this.translate.instant('auth.errors.invalidEmail');
      case 'auth/operation-not-allowed':
        return this.translate.instant('auth.errors.operationNotAllowed');
      case 'auth/weak-password':
        return this.translate.instant('auth.errors.weakPassword');
      case 'auth/too-many-requests':
        return this.translate.instant('auth.errors.tooManyRequests');
      case 'auth/popup-closed-by-user':
        return this.translate.instant('auth.errors.popupClosed');
      case 'auth/cancelled-popup-request':
        return this.translate.instant('auth.errors.popupCancelled');
      case 'auth/popup-blocked':
        return this.translate.instant('auth.errors.popupBlocked');
      default:
        return error?.message || this.translate.instant('auth.errors.registrationFailed');
    }
  }

  navigateToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-password'], {
      queryParams: { email: String(this.signupForm.value.email || '').trim().toLowerCase() }
    });
  }
}
