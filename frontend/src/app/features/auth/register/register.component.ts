import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '@core/services/auth.service';
import { Logger } from '@core/services/logger.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent implements OnInit {
  registerForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  useAzureLogin = true;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private logger: Logger
  ) {
    this.registerForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      agreeToTerms: [false, [Validators.requiredTrue]]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit(): void {
    // Check if user is already authenticated
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
  }

  // Azure AD B2C Registration
  registerWithAzure(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.authService.loginWithPopup().subscribe({
      next: (response) => {
        this.logger.info('Azure registration successful');
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.logger.error('Azure registration failed:', error);
        this.errorMessage = 'Registration failed. Please try again.';
        this.isLoading = false;
      }
    });
  }

  registerWithAzureRedirect(): void {
    this.authService.loginWithRedirect();
  }

  // Traditional Email/Password Registration
  onSubmit(): void {
    if (this.registerForm.valid) {
      this.isLoading = true;
      this.errorMessage = '';
      this.successMessage = '';

      const { name, email, password } = this.registerForm.value;

      this.authService.register({ name, email, password }).subscribe({
        next: (response) => {
          this.logger.info('Registration successful');
          
          // Check if email confirmation is required
          if ('requiresEmailConfirmation' in response && response.requiresEmailConfirmation) {
            // Show success message and redirect to email confirmation page
            this.successMessage = response.message || 'Registration successful! Please check your email to confirm your account.';
            this.isLoading = false;
            
            // Redirect after a short delay to show the message
            setTimeout(() => {
              this.router.navigate(['/auth/confirm-email'], {
                queryParams: {
                  email: email,
                  token: response.confirmationToken
                }
              });
            }, 2000);
          } else {
            // Direct login after registration
            this.router.navigate(['/dashboard']);
          }
        },
        error: (error) => {
          this.logger.error('Registration failed:', error);
          this.errorMessage = error.error?.message || 'Registration failed. Please try again.';
          this.isLoading = false;
        }
      });
    } else {
      this.markFormGroupTouched();
    }
  }

  toggleRegistrationMethod(): void {
    this.useAzureLogin = !this.useAzureLogin;
    this.errorMessage = '';
  }

  private passwordMatchValidator(form: FormGroup) {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');
    
    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
    
    return null;
  }

  private markFormGroupTouched(): void {
    Object.keys(this.registerForm.controls).forEach(key => {
      const control = this.registerForm.get(key);
      control?.markAsTouched();
    });
  }

  get name() {
    return this.registerForm.get('name');
  }

  get email() {
    return this.registerForm.get('email');
  }

  get password() {
    return this.registerForm.get('password');
  }

  get confirmPassword() {
    return this.registerForm.get('confirmPassword');
  }

  get agreeToTerms() {
    return this.registerForm.get('agreeToTerms');
  }
}
