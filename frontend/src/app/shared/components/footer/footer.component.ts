import { Component, inject } from '@angular/core';

import { Router } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss']
})
export class FooterComponent {
  private router = inject(Router);


  navigateToHowItWorks(): void {
    this.router.navigate(['/landing/how-it-works']);
  }

  navigateToContact(): void {
    this.router.navigate(['/landing/contact']);
  }

  navigateToFaq(): void {
    this.router.navigate(['/landing/faq']);
  }

  navigateToPrivacyPolicy(): void {
    this.router.navigate(['/landing/privacy-policy']);
  }

  navigateToTermsConditions(): void {
    this.router.navigate(['/landing/terms-conditions']);
  }
}
