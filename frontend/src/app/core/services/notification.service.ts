import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface Notification {
  id?: string;
  type: 'success' | 'error' | 'warning' | 'info' | 'outbid' | 'auction_ending' | 'auction_won';
  title: string;
  message: string;
  duration?: number;
  data?: any;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private notificationSubject = new Subject<Notification>();
  public notifications$: Observable<Notification> = this.notificationSubject.asObservable();

  showSuccess(title: string, message: string, duration: number = 5000): void {
    this.show({ type: 'success', title, message, duration });
  }

  showError(title: string, message: string, duration: number = 7000): void {
    this.show({ type: 'error', title, message, duration });
  }

  showWarning(title: string, message: string, duration: number = 5000): void {
    this.show({ type: 'warning', title, message, duration });
  }

  showInfo(title: string, message: string, duration: number = 5000): void {
    this.show({ type: 'info', title, message, duration });
  }

  show(notification: Notification): void {
    this.notificationSubject.next(notification);
  }
}

