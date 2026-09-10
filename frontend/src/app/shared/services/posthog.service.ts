import { Injectable, inject, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { CookiePreferencesService } from '../../landing/components/legal/cookie-preferences.service';
import { AnalyticsEventName, AnalyticsEventParams } from './analytics.events';

type PostHogClient = typeof import('posthog-js').default;

@Injectable({ providedIn: 'root' })
export class PostHogService {
  private readonly isBrowser  = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly router     = inject(Router);
  private readonly cookiePrefs = inject(CookiePreferencesService);

  private initialized = false;
  private ph: PostHogClient | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly cfg = (environment as { posthog?: { apiKey: string; apiHost: string; enabled: boolean } }).posthog;

  constructor() {
    if (!this.isBrowser) return;
    if (!this.cfg?.enabled || !this.cfg.apiKey) return;

    // When analytics consent is given, switch to cookie-backed persistence so
    // the user identity survives page reloads. When revoked, reset to memory-only.
    effect(() => {
      if (!this.initialized || !this.ph) return;
      if (this.cookiePrefs.analytics()) {
        this.ph.set_config({ persistence: 'localStorage+cookie' });
      } else {
        this.ph.set_config({ persistence: 'memory' });
        this.ph.reset();
      }
    });

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        if (this.initialized && this.ph) {
          this.ph.capture('$pageview', { $current_url: e.urlAfterRedirects });
        }
      });

    this.scheduleIdleInit();
  }

  private scheduleIdleInit(): void {
    const start = () => { void this.ensureInit(); };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(start, { timeout: 4000 });
    } else {
      setTimeout(start, 2000);
    }
  }

  private ensureInit(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    if (!this.cfg?.enabled || !this.cfg.apiKey) return Promise.resolve();

    this.initPromise = (async () => {
      const mod = await import('posthog-js');
      const posthog = mod.default;
      posthog.init(this.cfg!.apiKey, {
        api_host:         this.cfg!.apiHost,
        persistence:      'memory',
        respect_dnt:      true,
        capture_pageview: false,
        person_profiles:  'identified_only',
        session_recording: {
          maskAllInputs:    true,
          maskTextSelector: '[data-ph-mask]',
        },
      });
      this.ph = posthog;
      this.initialized = true;

      if (this.cookiePrefs.analytics()) {
        posthog.set_config({ persistence: 'localStorage+cookie' });
      }
    })().catch(() => {
      this.initPromise = null;
    });

    return this.initPromise ?? Promise.resolve();
  }

  track(name: AnalyticsEventName | string, params?: AnalyticsEventParams): void {
    void this.ensureInit().then(() => {
      if (this.initialized && this.ph) this.ph.capture(name, params ?? {});
    });
  }

  identify(uid: string, traits?: Record<string, string | number | boolean | null>): void {
    void this.ensureInit().then(() => {
      if (this.initialized && this.ph) this.ph.identify(uid, traits ?? {});
    });
  }

  setPersonProperties(props: Record<string, string | number | boolean>): void {
    void this.ensureInit().then(() => {
      if (this.initialized && this.ph) this.ph.setPersonProperties(props);
    });
  }

  reset(): void {
    if (!this.initialized || !this.ph) return;
    this.ph.reset();
  }

  isFeatureEnabled(flag: string): boolean {
    if (!this.initialized || !this.ph) return false;
    return this.ph.isFeatureEnabled(flag) ?? false;
  }
}
