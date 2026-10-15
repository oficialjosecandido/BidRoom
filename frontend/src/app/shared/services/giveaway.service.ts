import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

/**
 * What the listing page needs to render a giveaway. Public: anyone can read the
 * entry count and, once drawn, the winning number and the winner's public name
 * (first name and last initial). A signed-in viewer also gets their own entries
 * and whether the hourly cooldown still blocks another entry.
 */
export interface GiveawayState {
  entered: boolean;
  /** Most recent entry number (kept for simple “your number” UI). */
  entryNumber: number | null;
  /** All of this viewer's entry numbers, ascending. */
  entryNumbers?: number[];
  myEntryCount?: number;
  totalEntries: number;
  /** False while within one hour of the viewer's last entry. */
  canEnterAgain?: boolean;
  /** ISO time when canEnterAgain becomes true; null when already allowed. */
  nextEntryAt?: string | null;
  entriesOpen: boolean;
  endDate: string;
  drawn: boolean;
  drawnAt: string | null;
  winnerEntry: number | null;
  winnerName: string | null;
  youWon: boolean;
  /** The recording of the draw, once published. The server only ever returns allow-listed, canonical URLs. */
  drawVideo?: GiveawayDrawVideo | null;
}

export interface GiveawayDrawVideo {
  type: 'upload' | 'youtube' | 'instagram';
  url: string;
  /** YouTube only: the 11-character id to embed. */
  videoId?: string | null;
  /** Upload only: photo vs recording of the draw. */
  mediaKind?: 'image' | 'video' | null;
  publishedAt: string | null;
}

export interface GiveawayEnterResponse {
  success: boolean;
  entered: boolean;
  entryNumber: number;
  alreadyEntered: boolean;
  nextEntryAt?: string | null;
  canEnterAgain?: boolean;
}

/** Real-time event emitted to the listing room when the winner is drawn. */
export interface GiveawayDrawnEvent {
  listingId: string;
  winnerEntry: number;
  winnerName: string | null;
}

/** Entry numbers are shown as #0042 everywhere — on the page, in Nexus, in notifications. */
export function formatEntryNumber(n: number | null | undefined): string {
  return n == null ? '' : String(n).padStart(4, '0');
}

@Injectable({
  providedIn: 'root'
})
export class GiveawayService {
  private http = inject(HttpClient);

  private apiUrl = `${API_CONFIG.getApiUrl()}/giveaways`;

  getState(listingId: string): Observable<GiveawayState> {
    return this.http.get<GiveawayState>(`${this.apiUrl}/${listingId}`);
  }

  /** Free. Same account may enter again after one hour; sooner returns 429. */
  enter(listingId: string): Observable<GiveawayEnterResponse> {
    return this.http.post<GiveawayEnterResponse>(`${this.apiUrl}/${listingId}/enter`, {});
  }
}
