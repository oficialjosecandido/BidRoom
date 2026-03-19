import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule],
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.scss']
})
export class ResetPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);

  resetPasswordForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  code = '';
  showPassword = false;
  showConfirmPassword = false;

  constructor() {
    this.resetPasswordForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(12), this.strongPasswordValidator]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit(): void {
    // Get Firebase oobCode from query parameters
    this.route.queryParams.subscribe(params => {
      this.code = params['oobCode'];
      if (!this.code) {
        this.errorMessage = this.translate.instant('auth.resetPassword.invalidCode');
        return;
      }
      // Optionally verify code to pre-validate
      this.authService.verifyPasswordResetCode(this.code).subscribe({
        next: () => { /* code verified successfully */ },
        error: () => {
          this.errorMessage = this.translate.instant('auth.resetPassword.expiredLink');
        }
      });
    });
  }

  strongPasswordValidator = (control: { value: string }) => {
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

  passwordMatchValidator = (form: FormGroup) => {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');
    
    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
    
    // Clear mismatch error if passwords match
    if (confirmPassword && confirmPassword.errors?.['passwordMismatch']) {
      delete confirmPassword.errors['passwordMismatch'];
      if (Object.keys(confirmPassword.errors).length === 0) {
        confirmPassword.setErrors(null);
      }
    }
    
    return null;
  }

  onSubmit(): void {
    // Mark all fields as touched to show validation errors
    Object.keys(this.resetPasswordForm.controls).forEach(key => {
      this.resetPasswordForm.get(key)?.markAsTouched();
    });

    // Double-check password validation before submitting
    const password = this.resetPasswordForm.value.password;
    if (password && !this.isStrongPassword(password)) {
      this.resetPasswordForm.get('password')?.setErrors({ strongPassword: true });
      this.errorMessage = this.translate.instant('auth.errors.weakPassword');
      return;
    }

    if (this.resetPasswordForm.valid && !this.isLoading && this.code) {
      this.isLoading = true;
      this.errorMessage = '';
      this.successMessage = '';

      this.authService.confirmPasswordReset(this.code, password).subscribe({
        next: () => {
          this.isLoading = false;
          this.successMessage = this.translate.instant('auth.resetPassword.successMessage');
          // Redirect to login after a delay
          setTimeout(() => {
            this.router.navigate(['/auth/login']);
          }, 3000);
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = error?.message || this.translate.instant('auth.resetPassword.resetFailed');
        }
      });
    } else {
      // Form is invalid - show appropriate error
      if (this.resetPasswordForm.get('password')?.errors) {
        const passwordErrors = this.resetPasswordForm.get('password')?.errors;
        if (passwordErrors?.['strongPassword']) {
          this.errorMessage = this.translate.instant('auth.errors.weakPassword');
        } else if (passwordErrors?.['minlength']) {
          this.errorMessage = this.translate.instant('auth.errors.passwordMinLength');
        }
      }
      if (this.resetPasswordForm.errors?.['passwordMismatch']) {
        this.errorMessage = this.translate.instant('auth.errors.passwordMismatch');
      }
    }
  }

  isStrongPassword(password: string): boolean {
    if (!password) return false;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasMinimumLength = password.length >= 12;
    return hasUpperCase && hasLowerCase && hasNumbers && hasMinimumLength;
  }

  hasMinimumLength(password: string | null | undefined): boolean {
    if (!password) return false;
    return password.length >= 12;
  }

  hasUpperCase(password: string | null | undefined): boolean {
    if (!password) return false;
    return /[A-Z]/.test(password);
  }

  hasLowerCase(password: string | null | undefined): boolean {
    if (!password) return false;
    return /[a-z]/.test(password);
  }

  hasNumber(password: string | null | undefined): boolean {
    if (!password) return false;
    return /\d/.test(password);
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
    const field = this.resetPasswordForm.get(fieldName);
    if (field?.errors && field.touched) {
      if (field.errors['required']) {
        return this.translate.instant('auth.errors.fieldRequired', { field: this.translate.instant('auth.resetPassword.' + fieldName) });
      }
      if (field.errors['minlength']) {
        return this.translate.instant('auth.errors.passwordMinLength');
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
}
