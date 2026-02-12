import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  returnUrl = '';
  showPassword = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    // Get return url from route parameters or default to dashboard home
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard/home';
    
    // Check if redirected here due to unverified email
    if (this.route.snapshot.queryParams['verifyEmail'] === 'true') {
      this.errorMessage = 'Please verify your email address before accessing your account. Check your inbox for the verification email.';
    }
  }

  onSubmit(): void {
    if (this.loginForm.valid && !this.isLoading) {
      this.isLoading = true;
      this.errorMessage = '';

      this.authService.login(this.loginForm.value.email, this.loginForm.value.password).subscribe({
        next: (user) => {
          this.isLoading = false;
          // Check if user is admin and has a saved admin route
          const adminRoute = localStorage.getItem('admin_route');
          if (user.email?.toLowerCase() === 'josevcandido@gmail.com' && adminRoute) {
            this.router.navigate([adminRoute]);
          } else {
            this.router.navigate([this.returnUrl]);
          }
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = this.getErrorMessage(error);
        }
      });
    }
  }

  loginWithGoogle(): void {
    if (this.isLoading) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.authService.loginWithGoogle().subscribe({
      next: (user) => {
        this.isLoading = false;
        // Check if user is admin and has a saved admin route
        const adminRoute = localStorage.getItem('admin_route');
        if (user.email?.toLowerCase() === 'josevcandido@gmail.com' && adminRoute) {
          this.router.navigate([adminRoute]);
        } else {
          this.router.navigate([this.returnUrl]);
        }
      },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = this.getErrorMessage(error);
        }
    });
  }

  navigateToSignup(): void {
    this.router.navigate(['/auth/signup']);
  }

  navigateToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-password']);
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  getFieldError(fieldName: string): string {
    const field = this.loginForm.get(fieldName);
    if (field?.errors && field.touched) {
      if (field.errors['required']) {
        return `${fieldName} is required`;
      }
      if (field.errors['email']) {
        return 'Please enter a valid email address';
      }
    }
    return '';
  }

  getErrorMessage(error: any): string {
    const errorCode = error?.code || '';
    
    switch (errorCode) {
      case 'auth/user-not-found':
        return 'No account found with this email address. Please sign up or check your email.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Incorrect password. Please try again or reset your password.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Please contact support.';
      case 'auth/too-many-requests':
        return 'Too many failed login attempts. Please try again later or reset your password.';
      case 'auth/operation-not-allowed':
        return 'This operation is not allowed. Please contact support.';
      case 'auth/popup-closed-by-user':
        return 'Sign-in popup was closed. Please try again.';
      case 'auth/cancelled-popup-request':
        return 'Only one popup request is allowed at a time. Please try again.';
      case 'auth/popup-blocked':
        return 'Popup was blocked by your browser. Please allow popups and try again.';
      default:
        return error?.message || 'Login failed. Please try again.';
    }
  }
}
