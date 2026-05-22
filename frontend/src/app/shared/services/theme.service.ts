import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../auth/services/auth.service';
import { API_CONFIG } from '../config/api.config';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bidroom-theme-preference';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private apiUrl = `${API_CONFIG.getApiUrl()}/customers`;

  private mql: MediaQueryList | null = null;
  private readonly onOsThemeChange = (): void => {
    if (this.preference() !== 'system') return;
    this.applyResolvedDom(this.resolveEffective('system'));
  };

  /** User choice: light, dark, or match OS. */
  readonly preference = signal<ThemePreference>('system');

  /** Resolved theme applied to the DOM (light or dark). */
  readonly effective = computed(() => this.resolveEffective(this.preference()));

  /** Apply server profile theme only once per session (avoid resetting user choice on every API call). */
  private profileThemeMerged = false;

  /** Runs before first render via APP_INITIALIZER. */
  initFromStorageSync(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = this.parsePreference(raw);
    this.applyPreference(p, { persistLocal: true, patchServer: false });
  }

  /** When profile loads, server value wins for logged-in users (cross-device). */
  mergeFromServerIfPresent(theme: string | null | undefined): void {
    if (this.profileThemeMerged) return;
    this.profileThemeMerged = true;
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      this.applyPreference(theme, { persistLocal: true, patchServer: false });
    }
  }

  setPreference(p: ThemePreference): void {
    this.applyPreference(p, { persistLocal: true, patchServer: true });
  }

  parsePreference(raw: string | null): ThemePreference {
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    return 'system';
  }

  private applyPreference(
    p: ThemePreference,
    opts: { persistLocal: boolean; patchServer: boolean }
  ): void {
    if (typeof document === 'undefined') return;

    this.detachMql();
    if (p === 'system') {
      this.mql = window.matchMedia('(prefers-color-scheme: dark)');
      this.mql.addEventListener('change', this.onOsThemeChange);
    }

    this.preference.set(p);
    this.applyResolvedDom(this.resolveEffective(p));

    if (opts.persistLocal) {
      localStorage.setItem(STORAGE_KEY, p);
    }

    if (opts.patchServer && this.auth.getCurrentUser()) {
      this.http.patch<{ theme: ThemePreference }>(`${this.apiUrl}/theme`, { theme: p }).subscribe({
        error: () => {
          /* offline or session edge — local preference still applies */
        }
      });
    }
  }

  resolveEffective(p: ThemePreference): 'light' | 'dark' {
    if (p === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return p;
  }

  private applyResolvedDom(resolved: 'light' | 'dark'): void {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.setProperty('color-scheme', resolved);
  }

  private detachMql(): void {
    if (this.mql) {
      this.mql.removeEventListener('change', this.onOsThemeChange);
      this.mql = null;
    }
  }
}
