import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '@environments/environment';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class SocketService implements OnDestroy {
  private socket: Socket | null = null;
  private eventSubjects = new Map<string, Subject<any>>();

  constructor(private authService: AuthService) {
    // Connect socket when user is authenticated
    this.authService.currentUser$.subscribe((user) => {
      if (user) {
        this.connect();
      } else {
        this.disconnect();
      }
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.eventSubjects.forEach(subject => subject.complete());
    this.eventSubjects.clear();
  }

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    this.authService.getAccessToken().subscribe({
      next: (token) => {
        this.socket = io(environment.socketUrl, {
          auth: { token },
          autoConnect: true,
          transports: ['websocket', 'polling'],
        });

        this.setupEventListeners();
      },
      error: (error) => {
        console.error('Failed to get access token for socket connection:', error);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    // Generic event listener that forwards to observables
    const events = [
      'auction:state', 'bid:new', 'bid:success', 'bid:error',
      'auction:bid-history', 'auction:watch:success', 'auction:unwatch:success',
      'notification', 'error', 'connect', 'disconnect'
    ];

    events.forEach(eventName => {
      this.socket?.on(eventName, (data: any) => {
        this.getEventSubject(eventName).next(data);
      });
    });
  }

  private getEventSubject(eventName: string): Subject<any> {
    if (!this.eventSubjects.has(eventName)) {
      this.eventSubjects.set(eventName, new Subject<any>());
    }
    return this.eventSubjects.get(eventName)!;
  }

  private emit(eventName: string, data?: any): void {
    if (this.socket?.connected) {
      this.socket.emit(eventName, data);
    } else {
      console.warn(`Socket not connected. Cannot emit event: ${eventName}`);
    }
  }

  // Auction events
  joinAuction(auctionId: string): void {
    this.emit('auction:join', auctionId);
  }

  leaveAuction(auctionId: string): void {
    this.emit('auction:leave', auctionId);
  }

  onAuctionState(): Observable<any> {
    return this.getEventSubject('auction:state').asObservable();
  }

  onNewBid(): Observable<any> {
    return this.getEventSubject('bid:new').asObservable();
  }

  // Bidding events
  placeBid(bidData: any): void {
    this.emit('bid:place', bidData);
  }

  onBidSuccess(): Observable<any> {
    return this.getEventSubject('bid:success').asObservable();
  }

  onBidError(): Observable<any> {
    return this.getEventSubject('bid:error').asObservable();
  }

  getBidHistory(auctionId: string): void {
    this.emit('auction:bid-history', auctionId);
  }

  onBidHistory(): Observable<any> {
    return this.getEventSubject('auction:bid-history').asObservable();
  }

  // Watchlist events
  watchAuction(auctionId: string): void {
    this.emit('auction:watch', auctionId);
  }

  unwatchAuction(auctionId: string): void {
    this.emit('auction:unwatch', auctionId);
  }

  onWatchSuccess(): Observable<any> {
    return this.getEventSubject('auction:watch:success').asObservable();
  }

  onUnwatchSuccess(): Observable<any> {
    return this.getEventSubject('auction:unwatch:success').asObservable();
  }

  // Notification events
  onNotification(): Observable<any> {
    return this.getEventSubject('notification').asObservable();
  }

  markNotificationAsRead(notificationId: string): void {
    this.emit('notification:read', notificationId);
  }

  // General events
  onError(): Observable<any> {
    return this.getEventSubject('error').asObservable();
  }

  onConnect(): Observable<any> {
    return this.getEventSubject('connect').asObservable();
  }

  onDisconnect(): Observable<any> {
    return this.getEventSubject('disconnect').asObservable();
  }
}

