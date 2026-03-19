import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../services/auth.service';
import { isAdminEmail } from '../../../shared/config/admin.constants';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);

  loginForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  returnUrl = '';
  showPassword = false;

  constructor() {
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
      this.errorMessage = this.translate.instant('auth.login.verifyEmailRequired');
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
          if (isAdminEmail(user.email) && adminRoute) {
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
        return this.translate.instant('auth.errors.fieldRequired', { field: this.translate.instant('auth.common.' + fieldName) });
      }
      if (field.errors['email']) {
        return this.translate.instant('auth.errors.invalidEmail');
      }
    }
    return '';
  }

  getErrorMessage(error: { code?: string; message?: string }): string {
    const errorCode = error?.code || '';

    switch (errorCode) {
      case 'auth/user-not-found':
        return this.translate.instant('auth.errors.userNotFound');
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return this.translate.instant('auth.errors.wrongPassword');
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
