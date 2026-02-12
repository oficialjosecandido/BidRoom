import { Component, inject } from '@angular/core';

import { Router } from '@angular/router';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

@Component({
  selector: 'app-how-it-works',
  standalone: true,
  imports: [HeaderComponent, FooterComponent],
  templateUrl: './how-it-works.component.html',
  styleUrls: ['./how-it-works.component.scss']
})
export class HowItWorksComponent {
  private router = inject(Router);

  navigateToAuth(): void {
    this.router.navigate(['/auth/signup']);
  }

  navigateToHome(): void {
    this.router.navigate(['/landing']);
  }
}
