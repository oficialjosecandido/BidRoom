import { Injectable, NgZone, inject } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { Auth, getIdToken } from '@angular/fire/auth';
import { API_CONFIG } from '../config/api.config';
import { logger } from '../utils/logger';

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
  status?: 'draft' | 'active' | 'pending_review' | 'ended' | 'cancelled';
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
  private firebaseAuth = inject(Auth);
  /** Re-joined on every successful connect/reconnect so listing rooms are not lost after disconnect */
  private joinedListingIds: Set<string> = new Set();
  private joinedPrivateRoomViewerId: string | null = null;
  private joinedUserUid: string | null = null;

  connect(): void {
    this.connectWithToken(undefined);
  }

  private connectWithToken(token: string | undefined): void {
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
        reconnectionDelayMax: 5000,
        auth: token ? { token } : {}
      });

      this.socket.on('connect', () => {
        logger.debug('Socket.io connected');
        this.flushRoomJoins();
      });

      this.socket.on('disconnect', () => {
        logger.debug('Socket.io disconnected');
      });

      this.socket.on('connect_error', (error) => {
        logger.error('Socket.io connection error', error);
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
    logger.debug('Joined listing room', listingId);
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
    logger.debug('Left listing room', listingId);
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
    // Get the Firebase ID token so the backend can verify this socket owns the uid.
    const firebaseUser = this.firebaseAuth.currentUser;
    if (!firebaseUser) {
      // No authenticated user — connect without token (join-user will be silently rejected)
      if (!this.socket?.connected) this.connect();
      this.socket?.emit('join-user', uid);
      return;
    }
    getIdToken(firebaseUser).then((token) => {
      // Update or create socket with the auth token for this and future connections.
      if (!this.socket) {
        this.connectWithToken(token);
        // flushRoomJoins will emit join-user after connect
      } else {
        // Update auth for future reconnections, then emit directly on current connection.
        (this.socket as any).auth = { token };
        if (!this.socket.connected) {
          this.socket.connect();
        } else {
          this.socket.emit('join-user', uid);
        }
      }
    }).catch(() => {
      // Token fetch failed — fall back gracefully
      if (!this.socket?.connected) this.connect();
      this.socket?.emit('join-user', uid);
    });
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
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = () => this.ngZone.run(() => observer.next());
      socket.on('new-notification', handler);
      return () => socket.off('new-notification', handler);
    });
  }

  /** Fired when the current user receives a private room invitation (time-sensitive prompt) */
  onPrivateRoomInvitation(): Observable<{ listingId: string; listingTitle: string }> {
    return new Observable((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: { listingId: string; listingTitle: string }) =>
        this.ngZone.run(() => observer.next(data));
      socket.on('private-room-invitation', handler);
      return () => socket.off('private-room-invitation', handler);
    });
  }

  onNewBid(): Observable<NewBidEvent> {
    return new Observable<NewBidEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: NewBidEvent) => this.ngZone.run(() => observer.next(data));
      socket.on('new-bid', handler);
      return () => socket.off('new-bid', handler);
    });
  }

  onListingUpdate(): Observable<ListingUpdateEvent> {
    return new Observable<ListingUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: ListingUpdateEvent) => this.ngZone.run(() => observer.next(data));
      socket.on('listing-update', handler);
      return () => socket.off('listing-update', handler);
    });
  }

  onNewOffer(): Observable<NewOfferEvent> {
    return new Observable<NewOfferEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: NewOfferEvent) => this.ngZone.run(() => observer.next(data));
      socket.on('new-offer', handler);
      return () => socket.off('new-offer', handler);
    });
  }

  onOfferUpdate(): Observable<OfferUpdateEvent> {
    return new Observable<OfferUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: OfferUpdateEvent) => this.ngZone.run(() => observer.next(data));
      socket.on('offer-update', handler);
      return () => socket.off('offer-update', handler);
    });
  }

  joinPrivateRoomViewer(listingId: string): void {
    this.joinedPrivateRoomViewerId = listingId;
    if (!this.socket?.connected) {
      this.connect();
    }
    this.socket?.emit('join-private-room-viewer', listingId);
    logger.debug('Joined private room viewer', listingId);
  }

  leavePrivateRoomViewer(listingId: string): void {
    if (this.joinedPrivateRoomViewerId === listingId) {
      this.joinedPrivateRoomViewerId = null;
    }
    this.socket?.emit('leave-private-room-viewer', listingId);
    logger.debug('Left private room viewer', listingId);
  }

  onPrivateRoomViewerCountUpdate(): Observable<ViewerCountUpdateEvent> {
    return new Observable<ViewerCountUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: ViewerCountUpdateEvent) => this.ngZone.run(() => observer.next(data));
      socket.on('private-room-viewer-count-update', handler);
      return () => socket.off('private-room-viewer-count-update', handler);
    });
  }

  onInvitationAccepted(): Observable<{ listingId: string; bidderId: string | null; bidderName: string; bidderFirstName: string; bidderLastName: string }> {
    return new Observable((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: { listingId: string; bidderId: string | null; bidderName: string; bidderFirstName: string; bidderLastName: string }) =>
        this.ngZone.run(() => observer.next(data));
      socket.on('invitation-accepted', handler);
      return () => socket.off('invitation-accepted', handler);
    });
  }

  onInvitationDeclined(): Observable<{ listingId: string; bidderId: string | null }> {
    return new Observable((observer) => {
      if (!this.socket) {
        this.connect();
      }
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: { listingId: string; bidderId: string | null }) =>
        this.ngZone.run(() => observer.next(data));
      socket.on('invitation-declined', handler);
      return () => socket.off('invitation-declined', handler);
    });
  }

  // ── Support chat ───────────────────────────────────────────────────────────

  /** Nexus agents join this room to receive all support messages in real time. */
  joinSupportAgents(): void {
    if (!this.socket?.connected) this.connect();
    this.socket?.emit('support:join-agents');
  }

  leaveSupportAgents(): void {
    this.socket?.emit('support:leave-agents');
  }

  onSupportMessage(): Observable<{ conversationId: string; message: Record<string, unknown> }> {
    return new Observable((observer) => {
      if (!this.socket) this.connect();
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: { conversationId: string; message: Record<string, unknown> }) =>
        this.ngZone.run(() => observer.next(data));
      socket.on('support:new-message', handler);
      return () => socket.off('support:new-message', handler);
    });
  }

  onSupportConversationUpdated(): Observable<{ conversationId: string; status: string }> {
    return new Observable((observer) => {
      if (!this.socket) this.connect();
      const socket = this.socket;
      if (!socket) return () => {};
      const handler = (data: { conversationId: string; status: string }) =>
        this.ngZone.run(() => observer.next(data));
      socket.on('support:conversation-updated', handler);
      return () => socket.off('support:conversation-updated', handler);
    });
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

