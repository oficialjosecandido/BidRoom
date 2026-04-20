import { Injectable, NgZone, inject } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface NewBidEvent {
  bid: any;
  listingId: string;
  currentPrice: number;
  bidCount: number;
  updatedAt: string;
}

export interface ListingUpdateEvent {
  listingId: string;
  currentPrice?: number;
  bidCount?: number;
  updatedAt?: string;
  privateRoomEndDate?: string;
  privateRoomStatus?: 'not-triggered' | 'eligible' | 'invited' | 'active' | 'ended';
  privateRoomClosedReason?: 'no_acceptances' | 'seller_left' | 'time_expired';
  status?: 'draft' | 'active' | 'ended' | 'cancelled';
  endDate?: string;
  winnerSelectionDeadline?: string;
  winner?: string;
  platinumBidderAcceptanceDeadline?: string;
}

export interface ViewerCountUpdateEvent {
  listingId: string;
  count: number;
}

/** Offer payload sent via socket (matches Offer from offers.service) */
export interface SocketOfferPayload {
  _id: string;
  listing: string;
  offerer: { _id: string; firstName: string; lastName: string; email: string } | null;
  amount: number;
  message?: string | null;
  status: string;
  respondedAt?: string | null;
  sellerResponse?: string | null;
  offererName?: string;
  offererInitials?: string;
  offererVerified?: boolean;
  offererTier?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewOfferEvent {
  listingId: string;
  offer: SocketOfferPayload;
}

export interface OfferUpdateEvent {
  listingId: string;
  offer: SocketOfferPayload;
  listingStatus?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket | null = null;
  private ngZone = inject(NgZone);
  /** Re-joined on every successful connect/reconnect so listing rooms are not lost after disconnect */
  private joinedListingIds: Set<string> = new Set();
  private joinedPrivateRoomViewerId: string | null = null;
  private joinedUserUid: string | null = null;

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    if (this.socket) {
      this.socket.connect();
      return;
    }

    const baseUrl = API_CONFIG.getBackendBaseUrl();

    // Run socket.io setup outside Angular's zone so internal timers/polling
    // don't trigger unnecessary change detection cycles.
    this.ngZone.runOutsideAngular(() => {
      this.socket = io(baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        reconnectionDelayMax: 5000
      });

      this.socket.on('connect', () => {
        console.log('🔌 Connected to Socket.io server');
        this.flushRoomJoins();
      });

      this.socket.on('disconnect', () => {
        console.log('🔌 Disconnected from Socket.io server');
      });

      this.socket.on('connect_error', (error) => {
        console.error('❌ Socket.io connection error:', error);
      });
    });
  }

  /** Re-subscribe to rooms after connect/reconnect (server-side rooms are per-socket). */
  private flushRoomJoins(): void {
    if (!this.socket?.connected) return;
    for (const id of this.joinedListingIds) {
      this.socket.emit('join-listing', id);
    }
    if (this.joinedPrivateRoomViewerId) {
      this.socket.emit('join-private-room-viewer', this.joinedPrivateRoomViewerId);
    }
    if (this.joinedUserUid) {
      this.socket.emit('join-user', this.joinedUserUid);
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.joinedListingIds.clear();
    this.joinedPrivateRoomViewerId = null;
    this.joinedUserUid = null;
  }

  joinListing(listingId: string): void {
    this.joinedListingIds.add(listingId);
    if (!this.socket?.connected) {
      this.connect();
    }
    this.socket?.emit('join-listing', listingId);
    console.log(`👤 Joined listing room: ${listingId}`);
  }

  /** Join multiple listing rooms at once (e.g. seller dashboard showing several listings). */
  joinListings(listingIds: string[]): void {
    for (const id of listingIds) {
      this.joinListing(id);
    }
  }

  leaveListing(listingId: string): void {
    this.joinedListingIds.delete(listingId);
    this.socket?.emit('leave-listing', listingId);
    console.log(`👤 Left listing room: ${listingId}`);
  }

  /** Leave multiple listing rooms at once. */
  leaveListings(listingIds: string[]): void {
    for (const id of listingIds) {
      this.leaveListing(id);
    }
  }

  /** Join user room for real-time notification updates (uid = Firebase/auth uid) */
  joinUser(uid: string): void {
    if (!uid) return;
    this.joinedUserUid = uid;
    if (!this.socket?.connected) {
      this.connect();
    }
    this.socket?.emit('join-user', uid);
  }

  leaveUser(uid: string): void {
    if (uid && this.joinedUserUid === uid) {
      this.joinedUserUid = null;
    }
    if (uid) {
      this.socket?.emit('leave-user', uid);
    }
  }

  /** Fired when a new notification is created for the current user (refresh badge/list) */
  onNewNotification(): Observable<void> {
    return new Observable<void>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const handler = () => this.ngZone.run(() => observer.next());
      this.socket?.on('new-notification', handler);
      return () => this.socket?.off('new-notification', handler);
    });
  }

  onNewBid(): Observable<NewBidEvent> {
    return new Observable<NewBidEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const handler = (data: NewBidEvent) => this.ngZone.run(() => observer.next(data));
      this.socket?.on('new-bid', handler);
      return () => this.socket?.off('new-bid', handler);
    });
  }

  onListingUpdate(): Observable<ListingUpdateEvent> {
    return new Observable<ListingUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const handler = (data: ListingUpdateEvent) => this.ngZone.run(() => observer.next(data));
      this.socket?.on('listing-update', handler);
      return () => this.socket?.off('listing-update', handler);
    });
  }

  onNewOffer(): Observable<NewOfferEvent> {
    return new Observable<NewOfferEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const handler = (data: NewOfferEvent) => this.ngZone.run(() => observer.next(data));
      this.socket?.on('new-offer', handler);
      return () => this.socket?.off('new-offer', handler);
    });
  }

  onOfferUpdate(): Observable<OfferUpdateEvent> {
    return new Observable<OfferUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const handler = (data: OfferUpdateEvent) => this.ngZone.run(() => observer.next(data));
      this.socket?.on('offer-update', handler);
      return () => this.socket?.off('offer-update', handler);
    });
  }

  joinPrivateRoomViewer(listingId: string): void {
    this.joinedPrivateRoomViewerId = listingId;
    if (!this.socket?.connected) {
      this.connect();
    }
    this.socket?.emit('join-private-room-viewer', listingId);
    console.log(`👁️ Joined private room viewer: ${listingId}`);
  }

  leavePrivateRoomViewer(listingId: string): void {
    if (this.joinedPrivateRoomViewerId === listingId) {
      this.joinedPrivateRoomViewerId = null;
    }
    this.socket?.emit('leave-private-room-viewer', listingId);
    console.log(`👁️ Left private room viewer: ${listingId}`);
  }

  onPrivateRoomViewerCountUpdate(): Observable<ViewerCountUpdateEvent> {
    return new Observable<ViewerCountUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const handler = (data: ViewerCountUpdateEvent) => this.ngZone.run(() => observer.next(data));
      this.socket?.on('private-room-viewer-count-update', handler);
      return () => this.socket?.off('private-room-viewer-count-update', handler);
    });
  }

  onInvitationAccepted(): Observable<{ listingId: string; bidderId: string | null; bidderName: string; bidderFirstName: string; bidderLastName: string }> {
    return new Observable((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const handler = (data: { listingId: string; bidderId: string | null; bidderName: string; bidderFirstName: string; bidderLastName: string }) =>
        this.ngZone.run(() => observer.next(data));
      this.socket?.on('invitation-accepted', handler);
      return () => this.socket?.off('invitation-accepted', handler);
    });
  }

  onInvitationDeclined(): Observable<{ listingId: string; bidderId: string | null }> {
    return new Observable((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const handler = (data: { listingId: string; bidderId: string | null }) =>
        this.ngZone.run(() => observer.next(data));
      this.socket?.on('invitation-declined', handler);
      return () => this.socket?.off('invitation-declined', handler);
    });
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

