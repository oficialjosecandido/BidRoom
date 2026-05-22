import { Component, OnInit, OnDestroy, computed, inject } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth/services/auth.service';
import { NotificationService } from '../shared/services/notification.service';
import { TransactionsService } from '../shared/services/transactions.service';
import { SocketService } from '../shared/services/socket.service';
import { ThemeService } from '../shared/services/theme.service';
import { BidroomLogoComponent } from '../shared/components/bidroom-logo/bidroom-logo.component';
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule, BidroomLogoComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private transactionsService = inject(TransactionsService);
  private socketService = inject(SocketService);
  private translate = inject(TranslateService);
  readonly theme = inject(ThemeService);
  readonly effectiveTheme = this.theme.effective;

  notificationUnreadCount = 0;
  pendingBuyerTransactions = 0;
  pendingSellerTransactions = 0;
  userName = '';
  userInitials = '';

  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private subs = new Subscription();

  constructor() {
    const saved = localStorage.getItem('lang') || 'pt';
    this.translate.use(saved);
  }

  get themeGlyph(): string {
    return this.theme.resolveEffective(this.theme.preference()) === 'dark' ? '☾' : '☀';
  }

  get langLabel(): string {
    const lang = this.translate.currentLang || 'pt';
    return lang === 'pt' ? 'EN' : 'PT';
  }

  cycleTheme(): void {
    const eff = this.theme.resolveEffective(this.theme.preference());
    this.theme.setPreference(eff === 'dark' ? 'light' : 'dark');
  }

  toggleLang(): void {
    const current = this.translate.currentLang || 'pt';
    const next = current === 'pt' ? 'en' : 'pt';
    this.translate.use(next);
    localStorage.setItem('lang', next);
  }

  ngOnInit(): void {
    this.notificationService.refreshUnreadCount();
    this.loadPendingTransactionCounts();
    this.refreshInterval = setInterval(() => {
      this.loadPendingTransactionCounts();
    }, 60000);

    this.subs.add(
      this.authService.currentUser$.subscribe((user) => {
        if (user?.uid) {
          this.socketService.joinUser(user.uid);
        }
        if (user?.displayName) {
          this.userName = user.displayName;
          this.userInitials = user.displayName
            .split(' ').slice(0, 2)
            .map((w: string) => w[0])
            .join('').toUpperCase();
        } else if (user?.email) {
          this.userName = user.email.split('@')[0];
          this.userInitials = this.userName[0].toUpperCase();
        } else {
          this.userName = '';
          this.userInitials = 'U';
        }
      })
    );
    this.subs.add(
      this.notificationService.unreadCount$.subscribe((count) => {
        this.notificationUnreadCount = count;
      })
    );
    this.subs.add(
      this.socketService.onNewNotification().subscribe(() => this.notificationService.refreshUnreadCount())
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  private loadPendingTransactionCounts(): void {
    this.transactionsService.getPendingCounts().subscribe({
      next: (counts) => {
        this.pendingBuyerTransactions = counts.buyer;
        this.pendingSellerTransactions = counts.seller;
      }
    });
  }

  get pendingTransactions(): number {
    return this.pendingBuyerTransactions + this.pendingSellerTransactions;
  }

  navigateToLanding(): void {
    this.router.navigate(['/landing']);
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/landing'])
    });
  }
}
