import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LegalLayoutComponent } from '../legal/legal-layout.component';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [ReactiveFormsModule, LegalLayoutComponent, TranslateModule],
  templateUrl: './contact.component.html',
  styleUrls: ['../legal/_legal-content.scss', './contact.component.scss']
})
export class ContactComponent {
  private fb = inject(FormBuilder);
  private translate = inject(TranslateService);

  contactForm: FormGroup;
  isSubmitting = false;
  submitMessage = '';

  constructor() {
    this.contactForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      subject: ['auction', Validators.required],
      message: ['', [Validators.required, Validators.minLength(10)]]
    });
  }

  onSubmit(): void {
    if (this.contactForm.valid) {
      this.isSubmitting = true;
      setTimeout(() => {
        this.isSubmitting = false;
        this.submitMessage = this.translate.instant('legal.contact.success');
        this.contactForm.reset({ subject: 'auction' });
      }, 1500);
    } else {
      Object.keys(this.contactForm.controls).forEach((key) => {
        this.contactForm.get(key)?.markAsTouched();
      });
    }
  }

  getFieldError(fieldName: string): string {
    const field = this.contactForm.get(fieldName);
    if (!field?.errors || !field.touched) return '';
    if (field.errors['required']) {
      return this.translate.instant('legal.contact.errorRequired', {
        field: this.translate.instant(`legal.contact.${fieldName}`)
      });
    }
    if (field.errors['email']) {
      return this.translate.instant('legal.contact.errorEmail');
    }
    if (field.errors['minlength']) {
      return this.translate.instant('legal.contact.errorMinLength', {
        min: field.errors['minlength'].requiredLength
      });
    }
    return '';
  }
}
