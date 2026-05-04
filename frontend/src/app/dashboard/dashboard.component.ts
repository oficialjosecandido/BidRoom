import { Component, OnInit, OnDestroy, inject } from '@angular/core';

import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth/services/auth.service';
import { NotificationService } from '../shared/services/notification.service';
import { TransactionsService } from '../shared/services/transactions.service';
import { SocketService } from '../shared/services/socket.service';
import { ThemePreference, ThemeService } from '../shared/services/theme.service';

const STORAGE_KEY = 'bidroom-dashboard-sidebar-collapsed';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private transactionsService = inject(TransactionsService);
  private socketService = inject(SocketService);
  readonly theme = inject(ThemeService);

  readonly themeChoices: { id: ThemePreference; icon: string }[] = [
    { id: 'light', icon: '☀️' },
    { id: 'dark', icon: '🌙' },
    { id: 'system', icon: '💻' }
  ];

  sidebarCollapsed = false;
  notificationUnreadCount = 0;
  pendingBuyerTransactions = 0;
  pendingSellerTransactions = 0;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private subs = new Subscription();

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      this.sidebarCollapsed = stored === 'true';
    }
  }

  ngOnInit(): void {
    this.loadNotificationCount();
    this.loadPendingTransactionCounts();
    this.refreshInterval = setInterval(() => {
      this.loadNotificationCount();
      this.loadPendingTransactionCounts();
    }, 60000);

    // Join user room and listen for real-time notification updates
    this.subs.add(
      this.authService.currentUser$.subscribe((user) => {
        if (user?.uid) {
          this.socketService.joinUser(user.uid);
        }
      })
    );
    this.subs.add(
      this.socketService.onNewNotification().subscribe(() => this.loadNotificationCount())
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private loadNotificationCount(): void {
    this.notificationService.getUnreadCount().subscribe({
      next: (res) => { this.notificationUnreadCount = res.unreadCount; }
    });
  }

  private loadPendingTransactionCounts(): void {
    this.transactionsService.getPendingCounts().subscribe({
      next: (counts) => {
        this.pendingBuyerTransactions = counts.buyer;
        this.pendingSellerTransactions = counts.seller;
      }
    });
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    localStorage.setItem(STORAGE_KEY, String(this.sidebarCollapsed));
  }

  navigateToLanding(): void {
    this.router.navigate(['/landing']);
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        this.router.navigate(['/landing']);
      }
    });
  }
}

