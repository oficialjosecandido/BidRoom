import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { Logger } from '@core/services/logger.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  useAzureLogin = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private logger: Logger
  ) {
    this.loginForm = this.fb.group({
      email: ['pt.waverent@gmail.com', [Validators.required, Validators.email]],
      password: ['portugal', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    // Check if user is already authenticated
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
  }

  // Azure AD Login
  loginWithAzure(): void {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      // Use redirect instead of popup for better reliability
      this.authService.loginWithRedirect();
    } catch (error) {
      this.logger.error('Azure login failed:', error);
      this.errorMessage = 'Login failed. Please try again.';
      this.isLoading = false;
    }
  }

  loginWithAzureRedirect(): void {
    this.authService.loginWithRedirect();
  }

  // Traditional Email/Password Login
  onSubmit(): void {
    if (this.loginForm.valid) {
      this.isLoading = true;
      this.errorMessage = '';

      const { email, password } = this.loginForm.value;

      this.authService.login(email, password).subscribe({
        next: (response) => {
          this.logger.info('Login successful');
          this.router.navigate(['/dashboard']);
        },
        error: (error) => {
          this.logger.error('Login failed:', error);
          this.errorMessage = error.error?.message || 'Login failed. Please try again.';
          this.isLoading = false;
        }
      });
    } else {
      this.markFormGroupTouched();
    }
  }

  toggleLoginMethod(): void {
    this.useAzureLogin = !this.useAzureLogin;
    this.errorMessage = '';
  }

  private markFormGroupTouched(): void {
    Object.keys(this.loginForm.controls).forEach(key => {
      const control = this.loginForm.get(key);
      control?.markAsTouched();
    });
  }

  get email() {
    return this.loginForm.get('email');
  }

  get password() {
    return this.loginForm.get('password');
  }
}
