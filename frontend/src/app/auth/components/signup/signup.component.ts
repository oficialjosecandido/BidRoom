import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss']
})
export class SignupComponent implements OnInit {
  signupForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.signupForm = this.fb.group({
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(12), this.strongPasswordValidator]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit(): void {}

  strongPasswordValidator(control: any) {
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
          this.successMessage = 'Registration successful! Please check your email to verify your account.';
          // Optionally redirect to login after a delay
          setTimeout(() => {
            this.router.navigate(['/login']);
          }, 3000);
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
        this.router.navigate(['/dashboard']);
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
      if (field.errors['required']) {
        return `${fieldName} is required`;
      }
      if (field.errors['email']) {
        return 'Please enter a valid email address';
      }
      if (field.errors['emailExists']) {
        return 'This email is already registered';
      }
      if (field.errors['minlength']) {
        return `${fieldName} must be at least ${field.errors['minlength'].requiredLength} characters long`;
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

  getErrorMessage(error: any): string {
    const errorCode = error?.code || '';
    
    switch (errorCode) {
      case 'auth/email-already-in-use':
        return 'This email address is already registered. Please log in instead or use a different email.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/operation-not-allowed':
        return 'This operation is not allowed. Please contact support.';
      case 'auth/weak-password':
        return 'The password is too weak. Please choose a stronger password.';
      case 'auth/popup-closed-by-user':
        return 'Sign-in popup was closed. Please try again.';
      case 'auth/cancelled-popup-request':
        return 'Only one popup request is allowed at a time. Please try again.';
      case 'auth/popup-blocked':
        return 'Popup was blocked by your browser. Please allow popups and try again.';
      default:
        return error?.message || 'Registration failed. Please try again.';
    }
  }

  navigateToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-password'], {
      queryParams: { email: this.signupForm.value.email }
    });
  }
}
