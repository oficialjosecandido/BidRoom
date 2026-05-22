import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import Swal from 'sweetalert2';
import { AuthService } from '../../../auth/services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { SocketService } from '../../services/socket.service';
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
  private socketService = inject(SocketService);
  private translate = inject(TranslateService);
  readonly theme = inject(ThemeService);

  @Input() activePage = '';

  isAuthenticated$!: Observable<boolean>;
  menuOpen = false;
  searchOpen = false;
  notifCount = 0;
  userInitials = '';

  private subs = new Subscription();
  private currentUserUid: string | null = null;

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

    // Join the user's personal socket room as soon as authenticated so
    // notification badge and invitation alerts work on every page.
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
        if (user?.uid) {
          if (this.currentUserUid !== user.uid) {
            if (this.currentUserUid) this.socketService.leaveUser(this.currentUserUid);
            this.currentUserUid = user.uid;
            this.socketService.joinUser(user.uid);
          }
          this.notificationService.refreshUnreadCount();
        } else {
          if (this.currentUserUid) {
            this.socketService.leaveUser(this.currentUserUid);
            this.currentUserUid = null;
          }
          this.notifCount = 0;
        }
      })
    );

    // Refresh badge on any in-app notification (works globally now that user room is joined here)
    this.subs.add(
      this.socketService.onNewNotification().subscribe(() => {
        this.notificationService.refreshUnreadCount();
      })
    );

    // Show a time-sensitive prompt when a private room invitation arrives
    this.subs.add(
      this.socketService.onPrivateRoomInvitation().subscribe(({ listingId, listingTitle }) => {
        Swal.fire({
          title: "You're invited!",
          html: `You have been invited to a private auction room for <strong>${listingTitle}</strong>.<br>You have <strong>15 minutes</strong> to accept.`,
          icon: 'info',
          showCancelButton: true,
          confirmButtonText: 'Go to room',
          cancelButtonText: 'Dismiss',
          confirmButtonColor: '#2563eb'
        }).then(result => {
          if (result.isConfirmed) {
            this.router.navigateByUrl(`/private-room/auction/${listingId}`);
          }
        });
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get currentLang(): string {
    return this.translate.currentLang || 'pt';
  }

  get themeGlyph(): string {
    return this.theme.resolveEffective(this.theme.preference()) === 'dark' ? '☾' : '☀';
  }

  cycleTheme(): void {
    const eff = this.theme.resolveEffective(this.theme.preference());
    this.theme.setPreference(eff === 'dark' ? 'light' : 'dark');
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
      this.router.navigate(['/listing/list'], { queryParams: { search: q } });
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
