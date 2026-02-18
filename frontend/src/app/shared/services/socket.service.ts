import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';

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
  status?: 'draft' | 'active' | 'ended' | 'cancelled';
  endDate?: string;
  winnerSelectionDeadline?: string;
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

  private getApiUrl(): string {
    // Try to get from window config (for Azure Static Web Apps)
    if (typeof window !== 'undefined' && (window as any).APP_CONFIG?.API_URL) {
      const url = (window as any).APP_CONFIG.API_URL;
      // Remove /api suffix if present for WebSocket connection
      const baseUrl = url.replace('/api', '');
      // Ensure we have http/https prefix
      if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
        return baseUrl;
      }
      // If no protocol, default to https for production
      return baseUrl.startsWith('localhost') ? `http://${baseUrl}` : `https://${baseUrl}`;
    }
    
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000';
    }
    
    // Production default - Azure App Service
    return 'https://bidroom-backend-dev.azurewebsites.net';
  }

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    // Get API URL based on environment
    const apiUrl = this.getApiUrl();

    this.socket = io(apiUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      reconnectionDelayMax: 5000
    });

    this.socket.on('connect', () => {
      console.log('🔌 Connected to Socket.io server');
    });

    this.socket.on('disconnect', () => {
      console.log('🔌 Disconnected from Socket.io server');
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Socket.io connection error:', error);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  joinListing(listingId: string): void {
    if (!this.socket?.connected) {
      this.connect();
    }
    
    this.socket?.emit('join-listing', listingId);
    console.log(`👤 Joined listing room: ${listingId}`);
  }

  leaveListing(listingId: string): void {
    this.socket?.emit('leave-listing', listingId);
    console.log(`👤 Left listing room: ${listingId}`);
  }

  onNewBid(): Observable<NewBidEvent> {
    return new Observable<NewBidEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }

      const handler = (data: NewBidEvent) => {
        observer.next(data);
      };

      this.socket?.on('new-bid', handler);

      return () => {
        this.socket?.off('new-bid', handler);
      };
    });
  }

  onListingUpdate(): Observable<ListingUpdateEvent> {
    return new Observable<ListingUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }

      const handler = (data: ListingUpdateEvent) => {
        observer.next(data);
      };

      this.socket?.on('listing-update', handler);

      return () => {
        this.socket?.off('listing-update', handler);
      };
    });
  }

  onNewOffer(): Observable<NewOfferEvent> {
    return new Observable<NewOfferEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }

      const handler = (data: NewOfferEvent) => {
        observer.next(data);
      };

      this.socket?.on('new-offer', handler);

      return () => {
        this.socket?.off('new-offer', handler);
      };
    });
  }

  onOfferUpdate(): Observable<OfferUpdateEvent> {
    return new Observable<OfferUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }

      const handler = (data: OfferUpdateEvent) => {
        observer.next(data);
      };

      this.socket?.on('offer-update', handler);

      return () => {
        this.socket?.off('offer-update', handler);
      };
    });
  }

  joinPrivateRoomViewer(listingId: string): void {
    if (!this.socket?.connected) {
      this.connect();
    }
    
    this.socket?.emit('join-private-room-viewer', listingId);
    console.log(`👁️ Joined private room viewer: ${listingId}`);
  }

  leavePrivateRoomViewer(listingId: string): void {
    this.socket?.emit('leave-private-room-viewer', listingId);
    console.log(`👁️ Left private room viewer: ${listingId}`);
  }

  onPrivateRoomViewerCountUpdate(): Observable<ViewerCountUpdateEvent> {
    return new Observable<ViewerCountUpdateEvent>((observer) => {
      if (!this.socket) {
        this.connect();
      }

      const handler = (data: ViewerCountUpdateEvent) => {
        observer.next(data);
      };

      this.socket?.on('private-room-viewer-count-update', handler);

      return () => {
        this.socket?.off('private-room-viewer-count-update', handler);
      };
    });
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

