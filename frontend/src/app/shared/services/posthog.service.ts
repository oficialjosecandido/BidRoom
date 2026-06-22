import { Injectable, inject, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import posthog from 'posthog-js';
import { environment } from '../../../environments/environment';
import { CookiePreferencesService } from '../../landing/components/legal/cookie-preferences.service';
import { AnalyticsEventName, AnalyticsEventParams } from './analytics.events';

@Injectable({ providedIn: 'root' })
export class PostHogService {
  private readonly isBrowser  = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly router     = inject(Router);
  private readonly cookiePrefs = inject(CookiePreferencesService);

  private initialized = false;

  constructor() {
    if (!this.isBrowser) return;

    const cfg = (environment as { posthog?: { apiKey: string; apiHost: string; enabled: boolean } }).posthog;
    if (!cfg?.enabled || !cfg.apiKey) return;

    posthog.init(cfg.apiKey, {
      api_host:                    cfg.apiHost,
      opt_out_capturing_by_default: true,
      respect_dnt:                 true,
      capture_pageview:            false,
      person_profiles:             'identified_only',
      session_recording: {
        maskAllInputs:    true,
        maskTextSelector: '[data-ph-mask]',
      },
    });
    this.initialized = true;

    effect(() => {
      if (!this.initialized) return;
      if (this.cookiePrefs.analytics()) {
        posthog.opt_in_capturing();
      } else {
        posthog.opt_out_capturing();
      }
    });

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        if (this.canCapture()) {
          posthog.capture('$pageview', { $current_url: e.urlAfterRedirects });
        }
      });
  }

  track(name: AnalyticsEventName | string, params?: AnalyticsEventParams): void {
    if (!this.canCapture()) return;
    posthog.capture(name, params ?? {});
  }

  identify(uid: string, traits?: Record<string, string | number | boolean | null>): void {
    if (!this.initialized) return;
    posthog.identify(uid, traits ?? {});
  }

  setPersonProperties(props: Record<string, string | number | boolean>): void {
    if (!this.canCapture()) return;
    posthog.setPersonProperties(props);
  }

  reset(): void {
    if (!this.initialized) return;
    posthog.reset();
  }

  isFeatureEnabled(flag: string): boolean {
    if (!this.initialized) return false;
    return posthog.isFeatureEnabled(flag) ?? false;
  }

  private canCapture(): boolean {
    return this.initialized && this.cookiePrefs.analytics();
  }
}
