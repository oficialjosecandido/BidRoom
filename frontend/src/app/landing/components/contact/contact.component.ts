import { Component, inject } from '@angular/core';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [ReactiveFormsModule, HeaderComponent, FooterComponent, TranslateModule],
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss']
})
export class ContactComponent {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private translate = inject(TranslateService);

  contactForm: FormGroup;
  isSubmitting = false;
  submitMessage = '';

  constructor() {
    this.contactForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      subject: ['', [Validators.required, Validators.minLength(5)]],
      message: ['', [Validators.required, Validators.minLength(10)]],
      inquiryType: ['general', Validators.required]
    });
  }

  onSubmit(): void {
    if (this.contactForm.valid) {
      this.isSubmitting = true;
      
      // Simulate form submission
      setTimeout(() => {
        this.isSubmitting = false;
        this.submitMessage = this.translate.instant('contact.form.successMessage');
        this.contactForm.reset();
      }, 2000);
    } else {
      this.markFormGroupTouched();
    }
  }

  private markFormGroupTouched(): void {
    Object.keys(this.contactForm.controls).forEach(key => {
      const control = this.contactForm.get(key);
      control?.markAsTouched();
    });
  }

  getFieldError(fieldName: string): string {
    const field = this.contactForm.get(fieldName);
    if (field?.errors && field.touched) {
      if (field.errors['required']) {
        return this.translate.instant('contact.errors.fieldRequired', { field: this.translate.instant('contact.form.' + fieldName) });
      }
      if (field.errors['email']) {
        return this.translate.instant('auth.errors.invalidEmail');
      }
      if (field.errors['minlength']) {
        return this.translate.instant('contact.errors.minLength', { field: this.translate.instant('contact.form.' + fieldName), min: field.errors['minlength'].requiredLength });
      }
    }
    return '';
  }

  navigateToHome(): void {
    this.router.navigate(['/landing']);
  }
}
