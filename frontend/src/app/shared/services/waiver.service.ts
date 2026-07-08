import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface WaiverStatus {
  active: boolean;
  freeSalesCap: number;
  completedSales: number;
  freeSalesRemaining: number;
}

const DEFAULT: WaiverStatus = {
  active: false,
  freeSalesCap: 5,
  completedSales: 0,
  freeSalesRemaining: 0,
};

@Injectable({ providedIn: 'root' })
export class WaiverService {
  private http      = inject(HttpClient);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _status = signal<WaiverStatus>(DEFAULT);

  readonly status          = this._status.asReadonly();
  readonly freeSalesRemaining = computed(() => this._status().freeSalesRemaining);
  readonly waiverActive       = computed(() => this._status().active && this._status().freeSalesRemaining > 0);

  load(): void {
    if (!this.isBrowser) return;
    this.http.get<WaiverStatus>(`${API_CONFIG.getApiUrl()}/users/me/waiver-status`).pipe(
      catchError(() => of(DEFAULT))
    ).subscribe(s => this._status.set(s));
  }

  invalidate(): void {
    this._status.set(DEFAULT);
  }
}
