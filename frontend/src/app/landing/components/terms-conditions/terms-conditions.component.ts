import { Component, inject } from '@angular/core';

import { Router } from '@angular/router';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

@Component({
  selector: 'app-terms-conditions',
  standalone: true,
  imports: [HeaderComponent, FooterComponent],
  templateUrl: './terms-conditions.component.html',
  styleUrls: ['./terms-conditions.component.scss']
})
export class TermsConditionsComponent {
  private router = inject(Router);

  navigateToHome(): void {
    this.router.navigate(['/landing']);
  }
}
