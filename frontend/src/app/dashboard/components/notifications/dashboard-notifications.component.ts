import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NotificationService, Notification } from '../../../shared/services/notification.service';

@Component({
  selector: 'app-dashboard-notifications',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './dashboard-notifications.component.html',
  styleUrls: ['./dashboard-notifications.component.scss']
})
export class DashboardNotificationsComponent implements OnInit {
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  notifications: Notification[] = [];
  unreadCount = 0;
  loading = true;
  error: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.notificationService.getNotifications({ limit: 100 }).subscribe({
      next: (res) => {
        this.notifications = res.notifications || [];
        this.unreadCount = res.unreadCount ?? 0;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load notifications';
        this.loading = false;
      }
    });
  }

  /** Get navigation URL — prefer the stored link; fall back to sensible defaults by type */
  private getNotificationUrl(notification: Notification): string | null {
    if (notification.link) return notification.link;
    const fallbacks: Record<string, string> = {
      auction_ended: '/dashboard/buyer?tab=transactions',
      shipping: '/dashboard/buyer?tab=transactions',
      transaction: '/dashboard/buyer?tab=transactions',
      dispute: '/dashboard/disputes',
      listing: '/dashboard/seller',
      follow: '/dashboard/following',
      watchlist: '/dashboard/buyer?tab=watchlist',
      private_room: '/dashboard/buyer',
      account: '/dashboard/settings',
      security: '/dashboard/settings'
    };
    return fallbacks[notification.type] || null;
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
    if (url) this.router.navigateByUrl(url);
  }

  markAllAsRead(): void {
    if (this.unreadCount === 0) return;
    this.notificationService.markAllAsRead().subscribe({
      next: () => {
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

  getIconClass(type: string): string {
    const map: Record<string, string> = {
      bid: 'nico-bid',
      auction_ended: 'nico-bid',
      proposal: 'nico-offer',
      private_room: 'nico-offer',
      transaction: 'nico-tx',
      shipping: 'nico-tx',
      review: 'nico-tx',
      dispute: 'nico-err',
      account: 'nico-system',
      security: 'nico-system',
      listing: 'nico-system',
      watchlist: 'nico-system',
      system: 'nico-system'
    };
    return map[type] || 'nico-system';
  }

  formatDate(dateString: string): string {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
