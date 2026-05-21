import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../auth/services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { ThemeService } from '../../services/theme.service';
import { BidroomLogoComponent } from '../bidroom-logo/bidroom-logo.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AsyncPipe, RouterLink, TranslateModule, BidroomLogoComponent],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  readonly theme = inject(ThemeService);

  @Input() activePage = '';

  isAuthenticated$!: Observable<boolean>;
  menuOpen = false;
  searchOpen = false;
  notifCount = 0;
  userInitials = '';

  private subs = new Subscription();

  constructor() {
    this.isAuthenticated$ = this.authService.isAuthenticated();
    const saved = localStorage.getItem('lang') || 'pt';
    this.translate.use(saved);
  }

  ngOnInit(): void {
    this.subs.add(
      this.notificationService.unreadCount$.subscribe((count) => {
        this.notifCount = count;
      })
    );
    this.subs.add(
      this.authService.currentUser$.subscribe(user => {
        if (user?.displayName) {
          this.userInitials = user.displayName
            .split(' ').slice(0, 2)
            .map((w: string) => w[0])
            .join('').toUpperCase();
        } else if (user?.email) {
          this.userInitials = user.email[0].toUpperCase();
        } else {
          this.userInitials = '';
        }
        if (user) {
          this.notificationService.refreshUnreadCount();
        } else {
          this.notifCount = 0;
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get currentLang(): string {
    return this.translate.currentLang || 'pt';
  }

  switchLanguage(code: string): void {
    this.translate.use(code);
    localStorage.setItem('lang', code);
  }

  openSearch(): void {
    this.searchOpen = true;
    setTimeout(() => {
      const input = document.querySelector('.nav .search-bar input') as HTMLInputElement | null;
      input?.focus();
    }, 280);
  }

  closeSearch(): void {
    this.searchOpen = false;
  }

  doSearch(input: HTMLInputElement): void {
    const q = input.value.trim();
    if (q) {
      this.router.navigate(['/listing/list'], { queryParams: { q } });
      this.closeSearch();
      this.closeMenu();
    }
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  navigateToHome(): void {
    this.closeMenu();
    this.router.navigate(['/landing']);
  }

  navigateToAuctions(): void {
    this.closeMenu();
    this.router.navigate(['/listing/list']);
  }

  navigateToPrivateRooms(): void {
    this.closeMenu();
    this.router.navigate(['/landing'], { fragment: 'salas' });
  }

  navigateToHowItWorks(): void {
    this.closeMenu();
    this.router.navigate(['/landing/how-it-works']);
  }

  navigateToAddListing(): void {
    this.closeMenu();
    this.router.navigate(['/listing/add']);
  }

  navigateToDashboard(): void {
    this.closeMenu();
    this.router.navigate(['/dashboard']);
  }

  navigateToLogin(): void {
    this.closeMenu();
    this.router.navigate(['/auth/login']);
  }

  navigateToAuth(): void {
    this.closeMenu();
    this.router.navigate(['/auth/signup']);
  }
}
