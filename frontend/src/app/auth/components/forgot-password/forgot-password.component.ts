import { Component, OnInit, computed, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { BidroomLogoComponent } from '../../../shared/components/bidroom-logo/bidroom-logo.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, RouterLink, BidroomLogoComponent],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss']
})
export class ForgotPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);
  private themeService = inject(ThemeService);

  readonly isLight = computed(() => this.themeService.effective() === 'light');

  forgotPasswordForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  constructor() {
    this.forgotPasswordForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnInit(): void {
    const prefill = this.route.snapshot.queryParams['email'];
    if (prefill) {
      this.forgotPasswordForm.patchValue({ email: String(prefill).trim().toLowerCase() });
    }
  }

  onSubmit(): void {
    if (this.isLoading) return;
    this.errorMessage = '';
    this.successMessage = '';

    if (this.forgotPasswordForm.invalid) {
      this.forgotPasswordForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const email = String(this.forgotPasswordForm.value.email || '').trim().toLowerCase();

    this.authService.forgotPassword(email).subscribe({
      next: () => {
        this.isLoading = false;
        this.successMessage = this.translate.instant('auth.forgotPassword.successMessage');
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || this.translate.instant('auth.forgotPassword.sendFailed');
      }
    });
  }

  navigateToLogin(): void {
    this.router.navigate(['/auth/login'], {
      queryParams: this.forgotPasswordForm.value.email
        ? { email: String(this.forgotPasswordForm.value.email).trim().toLowerCase() }
        : undefined
    });
  }

  getFieldError(fieldName: string): string {
    const field = this.forgotPasswordForm.get(fieldName);
    if (field?.errors && field.touched) {
      if (field.errors['required']) {
        return this.translate.instant('auth.errors.emailRequired');
      }
      if (field.errors['email']) {
        return this.translate.instant('auth.errors.invalidEmail');
      }
    }
    return '';
  }
}
