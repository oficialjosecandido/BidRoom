import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.scss']
})
export class ResetPasswordComponent implements OnInit {
  resetPasswordForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  code = '';
  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
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
        this.errorMessage = 'Invalid or missing reset code.';
        return;
      }
      // Optionally verify code to pre-validate
      this.authService.verifyPasswordResetCode(this.code).subscribe({
        next: () => {},
        error: () => {
          this.errorMessage = 'The reset link is invalid or expired.';
        }
      });
    });
  }

  strongPasswordValidator = (control: any) => {
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
      this.errorMessage = 'Password must be at least 12 characters long and contain at least one uppercase letter, one lowercase letter, and one number';
      return;
    }

    if (this.resetPasswordForm.valid && !this.isLoading && this.code) {
      this.isLoading = true;
      this.errorMessage = '';
      this.successMessage = '';

      this.authService.confirmPasswordReset(this.code, password).subscribe({
        next: (response) => {
          this.isLoading = false;
          this.successMessage = 'Password reset successfully! You can now log in with your new password.';
          // Redirect to login after a delay
          setTimeout(() => {
            this.router.navigate(['/auth/login']);
          }, 3000);
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = error?.message || 'Failed to reset password. Please try again.';
        }
      });
    } else {
      // Form is invalid - show appropriate error
      if (this.resetPasswordForm.get('password')?.errors) {
        const passwordErrors = this.resetPasswordForm.get('password')?.errors;
        if (passwordErrors?.['strongPassword']) {
          this.errorMessage = 'Password must be at least 12 characters long and contain at least one uppercase letter, one lowercase letter, and one number';
        } else if (passwordErrors?.['minlength']) {
          this.errorMessage = 'Password must be at least 12 characters long';
        }
      }
      if (this.resetPasswordForm.errors?.['passwordMismatch']) {
        this.errorMessage = 'Passwords do not match';
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
        return `${fieldName} is required`;
      }
      if (field.errors['minlength']) {
        return 'Password must be at least 12 characters long';
      }
      if (field.errors['strongPassword']) {
        return 'Password must be at least 12 characters long and contain at least one uppercase letter, one lowercase letter, and one number';
      }
      if (field.errors['passwordMismatch']) {
        return 'Passwords do not match';
      }
    }
    return '';
  }
}
