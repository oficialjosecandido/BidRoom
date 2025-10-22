import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  @Input() activePage: string = '';

  constructor(private router: Router) {}

  navigateToAuth(): void {
    this.router.navigate(['/auth/signup']);
  }

  navigateToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  navigateToHome(): void {
    this.router.navigate(['/landing']);
  }

  navigateToHowItWorks(): void {
    this.router.navigate(['/landing/how-it-works']);
  }

  navigateToContact(): void {
    this.router.navigate(['/landing/contact']);
  }

  navigateToFaq(): void {
    this.router.navigate(['/landing/faq']);
  }
}
