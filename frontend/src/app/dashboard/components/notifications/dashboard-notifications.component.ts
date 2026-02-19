import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationService, Notification } from '../../../shared/services/notification.service';

@Component({
  selector: 'app-dashboard-notifications',
  standalone: true,
  imports: [CommonModule],
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
    if (notification.link) {
      this.router.navigateByUrl(notification.link);
    }
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
      system: '📢'
    };
    return icons[type] || '📢';
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
