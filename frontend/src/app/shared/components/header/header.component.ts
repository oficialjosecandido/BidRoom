import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { environment } from '@env';
import { AuthService } from '../../../auth/services/auth.service';
import { ProposalNotificationsComponent } from '../../../dashboard/components/proposal-notifications/proposal-notifications.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, TranslateModule, ProposalNotificationsComponent],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  private router = inject(Router);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);

  /** Shown only in non-production builds (e.g. local / dev deploy) */
  readonly showEnvBadge = !environment.production;

  @Input() activePage = '';
  isAuthenticated$!: Observable<boolean>;
  menuOpen = false;
  langMenuOpen = false;

  readonly languages = [
    { code: 'en', label: 'EN', name: 'English' },
    { code: 'pt', label: 'PT', name: 'Português' },
    { code: 'es', label: 'ES', name: 'Español' },
    { code: 'fr', label: 'FR', name: 'Français' }
  ];

  constructor() {
    this.isAuthenticated$ = this.authService.isAuthenticated();
    const saved = localStorage.getItem('lang') || 'en';
    this.translate.use(saved);
  }

  get currentLang(): string {
    return this.translate.currentLang || 'en';
  }

  get currentLangLabel(): string {
    return this.languages.find(l => l.code === this.currentLang)?.label ?? 'EN';
  }

  switchLanguage(code: string): void {
    this.translate.use(code);
    localStorage.setItem('lang', code);
    this.langMenuOpen = false;
  }

  toggleLangMenu(): void {
    this.langMenuOpen = !this.langMenuOpen;
  }

  closeLangMenu(): void {
    this.langMenuOpen = false;
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  navigateToAuth(): void {
    this.closeMenu();
    this.router.navigate(['/auth/signup']);
  }

  navigateToLogin(): void {
    this.closeMenu();
    this.router.navigate(['/auth/login']);
  }

  navigateToHome(): void {
    this.closeMenu();
    this.router.navigate(['/landing']);
  }

  navigateToHowItWorks(): void {
    this.closeMenu();
    this.router.navigate(['/landing/how-it-works']);
  }

  navigateToContact(): void {
    this.closeMenu();
    this.router.navigate(['/landing/contact']);
  }

  navigateToFaq(): void {
    this.closeMenu();
    this.router.navigate(['/landing/faq']);
  }

  navigateToAuctions(): void {
    this.closeMenu();
    this.router.navigate(['/landing']);
  }

  navigateToCategories(): void {
    this.closeMenu();
    this.router.navigate(['/landing'], { fragment: 'categories' });
  }

  navigateToAddListing(): void {
    this.closeMenu();
    this.router.navigate(['/listing/add']);
  }

  navigateToDashboard(): void {
    this.closeMenu();
    this.router.navigate(['/dashboard']);
  }
}
