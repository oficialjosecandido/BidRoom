import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LegalLayoutComponent } from '../legal/legal-layout.component';
import { SeoService } from '../../../shared/services/seo.service';

/** OpenStreetMap embed centred on Lisboa (NAP locality until a street address is confirmed). */
const LISBON_MAP =
  'https://www.openstreetmap.org/export/embed.html?bbox=-9.20%2C38.69%2C-9.10%2C38.75&layer=mapnik&marker=38.7223%2C-9.1393';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [ReactiveFormsModule, LegalLayoutComponent, TranslateModule],
  templateUrl: './contact.component.html',
  styleUrls: ['../legal/_legal-content.scss', './contact.component.scss']
})
export class ContactComponent implements OnInit {
  private fb = inject(FormBuilder);
  private translate = inject(TranslateService);
  private router = inject(Router);
  private seo = inject(SeoService);
  private sanitizer = inject(DomSanitizer);

  contactForm: FormGroup;
  isSubmitting = false;
  mapUrl: SafeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(LISBON_MAP);

  constructor() {
    this.contactForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      subject: ['auction', Validators.required],
      message: ['', [Validators.required, Validators.minLength(10)]]
    });
  }

  ngOnInit(): void {
    this.seo.setPage({
      title: this.translate.instant('seoPages.contact.titleTag'),
      description: this.translate.instant('seoPages.contact.description'),
      path: '/landing/contact',
    });
    this.seo.setBreadcrumbs([
      { name: 'BidRoom', path: '/' },
      { name: this.translate.instant('footer.contact'), path: '/landing/contact' },
    ]);
  }

  onSubmit(): void {
    if (this.contactForm.valid) {
      this.isSubmitting = true;
      // Conversion destination: dedicated thank-you URL for measurement.
      setTimeout(() => {
        this.isSubmitting = false;
        this.contactForm.reset({ subject: 'auction' });
        void this.router.navigate(['/landing/thank-you']);
      }, 900);
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
