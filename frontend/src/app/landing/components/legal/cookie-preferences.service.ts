import { Injectable, signal } from '@angular/core';

export interface CookiePreferences {
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

const STORAGE_KEY = 'bidroom-cookie-prefs';

@Injectable({ providedIn: 'root' })
export class CookiePreferencesService {
  readonly functional = signal(true);
  readonly analytics = signal(false);
  readonly marketing = signal(false);

  constructor() {
    this.load();
  }

  load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw) as CookiePreferences;
      this.functional.set(prefs.functional !== false);
      this.analytics.set(!!prefs.analytics);
      this.marketing.set(!!prefs.marketing);
    } catch {
      /* ignore */
    }
  }

  save(): void {
    const prefs: CookiePreferences = {
      functional: this.functional(),
      analytics: this.analytics(),
      marketing: this.marketing()
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
  }
}
