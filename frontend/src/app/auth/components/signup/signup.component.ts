import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslateModule],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss']
})
export class SignupComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  signupForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  showPassword = false;
  showConfirmPassword = false;

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
    
    return null;
  }

  onSubmit(): void {
    if (this.signupForm.valid && !this.isLoading) {
      this.isLoading = true;
      this.errorMessage = '';
      this.successMessage = '';

      const displayName = `${this.signupForm.value.firstName} ${this.signupForm.value.lastName}`.trim();

      this.authService.register(this.signupForm.value.email, this.signupForm.value.password, displayName).subscribe({
        next: () => {
          this.isLoading = false;
          this.router.navigate(['/auth/check-email'], {
            queryParams: { email: this.signupForm.value.email }
          });
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = this.getErrorMessage(error);
          // Mark email field as invalid if email is already in use
          if (error?.code === 'auth/email-already-in-use') {
            this.signupForm.get('email')?.setErrors({ emailExists: true });
            this.signupForm.get('email')?.markAsTouched();
          }
        }
      });
    }
  }

  loginWithGoogle(): void {
    if (this.isLoading) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.authService.loginWithGoogle().subscribe({
      next: () => {
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
    this.router.navigate(['/auth/login']);
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
        return this.translate.instant('auth.errors.emailAlreadyInUse');
      case 'auth/invalid-email':
        return this.translate.instant('auth.errors.invalidEmail');
      case 'auth/operation-not-allowed':
        return this.translate.instant('auth.errors.operationNotAllowed');
      case 'auth/weak-password':
        return this.translate.instant('auth.errors.weakPassword');
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
      queryParams: { email: this.signupForm.value.email }
    });
  }
}
