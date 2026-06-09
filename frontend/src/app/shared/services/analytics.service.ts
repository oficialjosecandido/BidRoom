import { Injectable, inject, effect } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { CookiePreferencesService } from '../../landing/components/legal/cookie-preferences.service';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly router = inject(Router);
  private readonly cookiePrefs = inject(CookiePreferencesService);
  private readonly measurementId = environment.googleAnalyticsId;

  constructor() {
    if (!environment.production || !this.measurementId) return;

    // Initialize gtag immediately with consent denied — GA4 uses modeling
    // to estimate traffic even without cookies. Consent is upgraded when
    // the user accepts analytics cookies.
    this.initConsentMode();

    effect(() => {
      if (this.cookiePrefs.analytics()) {
        this.grantConsent();
      }
    });
  }

  private initConsentMode(): void {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };

    // Must be called before the gtag script loads
    window.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500
    });

    window.gtag('js', new Date());
    window.gtag('config', this.measurementId!, { send_page_view: false });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${this.measurementId}`;
    document.head.appendChild(script);

    this.hookRouter();
    this.trackPageView(this.router.url);
  }

  private grantConsent(): void {
    if (!window.gtag) return;
    window.gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted'
    });
  }

  private hookRouter(): void {
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd)
    ).subscribe((e) => this.trackPageView(e.urlAfterRedirects));
  }

  private trackPageView(path: string): void {
    if (!window.gtag || !this.measurementId) return;
    window.gtag('config', this.measurementId, { page_path: path });
  }
}
