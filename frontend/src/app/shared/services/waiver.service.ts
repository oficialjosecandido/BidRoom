import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

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

/** Founding-seller free-sales campaign has ended — service kept as a no-op for call sites. */
@Injectable({ providedIn: 'root' })
export class WaiverService {
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _status = signal<WaiverStatus>(DEFAULT);

  readonly status = this._status.asReadonly();
  readonly freeSalesRemaining = computed(() => 0);
  readonly waiverActive = computed(() => false);

  load(): void {
    if (!this.isBrowser) return;
    this._status.set(DEFAULT);
  }

  invalidate(): void {
    this._status.set(DEFAULT);
  }
}
