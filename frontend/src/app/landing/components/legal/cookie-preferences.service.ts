import { Injectable, signal } from '@angular/core';

export type CookieConsentLevel = 'all' | 'essential';

export interface CookiePreferences {
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

const PREFS_KEY = 'bidroom-cookie-prefs';
const CONSENT_KEY = 'bidroom_cookie_consent';

@Injectable({ providedIn: 'root' })
export class CookiePreferencesService {
  readonly functional = signal(true);
  readonly analytics = signal(false);
  readonly marketing = signal(false);

  constructor() {
    this.load();
  }

  hasConsent(): boolean {
    if (typeof localStorage === 'undefined') return true;
    return !!localStorage.getItem(CONSENT_KEY) || !!this.readCookie(CONSENT_KEY);
  }

  get consentLevel(): CookieConsentLevel | null {
    const v = (typeof localStorage !== 'undefined' && localStorage.getItem(CONSENT_KEY))
      || this.readCookie(CONSENT_KEY);
    return v === 'all' || v === 'essential' ? v : null;
  }

  acceptAll(): void {
    this.functional.set(true);
    this.analytics.set(true);
    this.marketing.set(true);
    this.persistConsent('all');
  }

  rejectNonEssential(): void {
    this.functional.set(false);
    this.analytics.set(false);
    this.marketing.set(false);
    this.persistConsent('essential');
  }

  load(): void {
    if (typeof localStorage === 'undefined') return;
    // Restore from cookie if localStorage was cleared
    const cookieLevel = this.readCookie(CONSENT_KEY);
    if (cookieLevel && !localStorage.getItem(CONSENT_KEY)) {
      localStorage.setItem(CONSENT_KEY, cookieLevel);
    }
    const level = localStorage.getItem(CONSENT_KEY);
    if (level === 'all') {
      this.functional.set(true);
      this.analytics.set(true);
      this.marketing.set(true);
    } else if (level === 'essential') {
      this.functional.set(false);
      this.analytics.set(false);
      this.marketing.set(false);
    }
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw) as CookiePreferences;
      if (level) return;
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
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    }
  }

  /**
   * Apply a consent level fetched from the server without sending it back.
   * Used on initial load when the user is authenticated and already gave consent
   * on another device.
   */
  syncFromServer(level: 'all' | 'essential'): void {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(CONSENT_KEY)) {
      localStorage.setItem(CONSENT_KEY, level);
    }
    this.writeCookie(CONSENT_KEY, level, 365);
    if (level === 'all') {
      this.functional.set(true);
      this.analytics.set(true);
      this.marketing.set(true);
    } else {
      this.functional.set(false);
      this.analytics.set(false);
      this.marketing.set(false);
    }
  }

  /** Persist consent level from toggles on the cookies policy page. */
  applyConsentFromToggles(): void {
    const level: CookieConsentLevel =
      this.analytics() || this.marketing() ? 'all' : 'essential';
    this.persistConsent(level);
  }

  private persistConsent(level: CookieConsentLevel): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONSENT_KEY, level);
    }
    // Also write a long-lived cookie (1 year) so the choice survives localStorage clears
    this.writeCookie(CONSENT_KEY, level, 365);
    this.save();
  }

  private writeCookie(name: string, value: string, days: number): void {
    if (typeof document === 'undefined') return;
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${value}; max-age=${maxAge}; path=/; SameSite=Lax`;
  }

  private readCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
}
