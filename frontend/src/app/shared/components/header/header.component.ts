import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  @Input() activePage: string = '';
  isAuthenticated$!: Observable<boolean>;

  constructor(
    private router: Router,
    private authService: AuthService
  ) {
    this.isAuthenticated$ = this.authService.isAuthenticated();
  }

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

  navigateToAuctions(): void {
    this.router.navigate(['/landing']);
  }

  navigateToCategories(): void {
    this.router.navigate(['/landing'], { fragment: 'categories' });
  }

  navigateToAddListing(): void {
    this.router.navigate(['/listing/add']);
  }

  navigateToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }
}
