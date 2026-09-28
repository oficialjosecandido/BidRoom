import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

interface GuestSessionResponse {
  token: string;
  expiresAt: string;
}

const STORAGE_KEY = 'bidroom_guest_session';
/** Ask for a fresh ticket before the server's own expiry, so a slow upload never lands expired. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

/**
 * Holds the anonymous draft ticket that lets a visitor without an account upload
 * images and submit a listing. The ticket carries no identity — it exists only so
 * the upload endpoint has something to rate-limit before the email is known, which
 * is what allows the email to be asked for at the *end* of the form.
 *
 * Kept in sessionStorage so a reload mid-form does not throw away the uploads.
 */
@Injectable({ providedIn: 'root' })
export class GuestSessionService {
  private http = inject(HttpClient);
  private token: string | null = null;
  private expiresAt = 0;
  private pending: Promise<string> | null = null;

  /** A valid ticket, requesting one if there is none or it is about to expire. */
  async ensureToken(): Promise<string> {
    const cached = this.readCached();
    if (cached) return cached;
    // Concurrent callers (form init + first upload) must share one request, or the
    // per-IP ticket limiter burns through its hourly budget on a single visitor.
    this.pending ??= this.request().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Header for a guest request, or an empty set when there is no ticket. */
  headers(token: string | null = this.token): HttpHeaders {
    return token ? new HttpHeaders({ 'X-Guest-Token': token }) : new HttpHeaders();
  }

  clear(): void {
    this.token = null;
    this.expiresAt = 0;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode / storage disabled */
    }
  }

  private readCached(): string | null {
    if (this.token && this.expiresAt - RENEW_MARGIN_MS > Date.now()) return this.token;

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { token?: string; expiresAt?: number };
        if (saved?.token && typeof saved.expiresAt === 'number' && saved.expiresAt - RENEW_MARGIN_MS > Date.now()) {
          this.token = saved.token;
          this.expiresAt = saved.expiresAt;
          return this.token;
        }
      }
    } catch {
      /* unparseable or unavailable — fall through and ask for a new one */
    }
    return null;
  }

  private async request(): Promise<string> {
    const res = await firstValueFrom(
      this.http.post<GuestSessionResponse>(`${API_CONFIG.getApiUrl()}/listings/guest-session`, {})
    );
    this.token = res.token;
    this.expiresAt = new Date(res.expiresAt).getTime();
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: this.token, expiresAt: this.expiresAt }));
    } catch {
      /* in-memory only is fine; the ticket just will not survive a reload */
    }
    return this.token;
  }
}
