import { Injectable, inject, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { CookiePreferencesService } from '../../landing/components/legal/cookie-preferences.service';
import { AnalyticsEventName, AnalyticsEventParams } from './analytics.events';

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
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    if (!this.isBrowser || !environment.production || !this.measurementId) return;

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

  /** Send a custom GA4 event. Fires regardless of cookie consent — Consent Mode v2
   *  default ('denied') keeps these cookieless/modeled until the user opts in. */
  trackEvent(name: AnalyticsEventName | string, params?: AnalyticsEventParams): void {
    if (!this.canTrack()) return;
    const payload = params ? this.sanitizeParams(params) : {};
    window.gtag!('event', name, payload);
  }

  /** Common listing context for conversion events. */
  listingParams(listing: {
    _id?: string;
    slug?: string;
    auctionFormat?: string;
    category?: string;
  }): AnalyticsEventParams {
    return {
      listing_id: listing._id ?? '',
      listing_slug: listing.slug ?? '',
      auction_format: listing.auctionFormat ?? '',
      item_category: listing.category ?? '',
    };
  }

  /** Gate is intentionally consent-independent — Consent Mode v2 (set in
   *  initConsentMode/grantConsent) controls whether hits are cookied or
   *  cookieless, not whether they're sent at all. */
  private canTrack(): boolean {
    return !!(
      this.isBrowser &&
      environment.production &&
      this.measurementId &&
      window.gtag
    );
  }

  private sanitizeParams(params: AnalyticsEventParams): AnalyticsEventParams {
    const out: AnalyticsEventParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      out[key] = value;
    }
    return out;
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
    if (!this.canTrack()) return;
    window.gtag!('config', this.measurementId!, { page_path: path });
  }
}
