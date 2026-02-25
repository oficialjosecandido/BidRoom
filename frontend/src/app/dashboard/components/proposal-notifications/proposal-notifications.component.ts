import { Component, OnInit, OnDestroy, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { NotificationService, Notification } from '../../../shared/services/notification.service';
import { SocketService } from '../../../shared/services/socket.service';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-proposal-notifications',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './proposal-notifications.component.html',
  styleUrls: ['./proposal-notifications.component.scss']
})
export class ProposalNotificationsComponent implements OnInit, OnDestroy {
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private socketService = inject(SocketService);
  private authService = inject(AuthService);

  notifications: Notification[] = [];
  unreadCount = 0;
  loading = false;
  dropdownOpen = false;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private subs = new Subscription();

  ngOnInit(): void {
    this.load();
    this.refreshInterval = setInterval(() => this.load(), 60000);

    // Join user room and listen for real-time notification updates
    this.subs.add(
      this.authService.currentUser$.subscribe((user) => {
        if (user?.uid) {
          this.socketService.joinUser(user.uid);
        }
      })
    );
    this.subs.add(
      this.socketService.onNewNotification().subscribe(() => this.load())
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  load(): void {
    this.loading = true;
    this.notificationService.getNotifications({ limit: 5 }).subscribe({
      next: (res) => {
        this.notifications = res.notifications || [];
        this.unreadCount = res.unreadCount ?? 0;
        this.loading = false;
      },
      error: () => {
        this.notifications = [];
        this.unreadCount = 0;
        this.loading = false;
      }
    });
  }

  toggleDropdown(): void {
    this.dropdownOpen = !this.dropdownOpen;
    if (this.dropdownOpen) {
      this.load();
    }
  }

  closeDropdown(): void {
    this.dropdownOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (this.dropdownOpen && !target.closest('.proposal-notifications')) {
      this.closeDropdown();
    }
  }

  /** Get navigation URL for a notification (auction_ended always → transactions; fix old wrong links) */
  private getNotificationUrl(notification: Notification): string | null {
    if (notification.type === 'auction_ended') return '/dashboard/transactions';
    const fallbacks: Record<string, string> = {
      shipping: '/dashboard/transactions',
      dispute: '/dashboard/disputes',
      transaction: '/dashboard/transactions'
    };
    return notification.link || fallbacks[notification.type] || null;
  }

  openNotification(notification: Notification): void {
    if (notification.status === 'unread') {
      this.notificationService.markAsRead(notification._id).subscribe({
        next: () => {
          notification.status = 'read';
          notification.readAt = new Date().toISOString();
          this.unreadCount = Math.max(0, this.unreadCount - 1);
        }
      });
    }
    const url = this.getNotificationUrl(notification);
    if (url) {
      this.router.navigateByUrl(url);
    }
    this.closeDropdown();
  }

  markAllAsRead(): void {
    if (this.unreadCount === 0) return;
    this.notificationService.markAllAsRead().subscribe({
      next: (res) => {
        this.notifications.forEach(n => {
          n.status = 'read';
          n.readAt = new Date().toISOString();
        });
        this.unreadCount = 0;
      }
    });
  }

  getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      proposal: '💰',
      bid: '🔨',
      auction_ended: '🏁',
      transaction: '💳',
      dispute: '⚖️',
      review: '⭐',
      listing: '📋',
      watchlist: '👀',
      private_room: '🔒',
      shipping: '📦',
      account: '👤',
      security: '🔐',
      system: '📢'
    };
    return icons[type] || '📢';
  }

  formatDate(dateString: string): string {
    const d = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }
}
