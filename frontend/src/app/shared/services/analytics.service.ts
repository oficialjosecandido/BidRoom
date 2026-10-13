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

    // gtag itself (script tag + consent default + initial config) is
    // bootstrapped statically in index.html — before Angular even loads —
    // so GA4's install check can see it and so consent defaults are set as
    // early as possible. We just hook routing and the consent upgrade here.
    this.hookRouter();
    this.trackPageView(this.router.url);

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

  /**
   * What GA has always called this listing's format, from what the app now
   * calls its selling mode.
   *
   * The app renamed `auctionFormat: 'highest-bid' | 'best-offer'` to
   * `sellingMode: 'bidding' | 'offers'`, but years of events are already in GA
   * under the old property name and the old values. Renaming them there would
   * split every report in two at the deploy date, with no way to join the
   * halves back up — so the wire format is pinned and the translation happens
   * here. This is the only place in the app that still speaks the old words.
   *
   * There are two maps because GA holds two properties for the one idea:
   * `auction_format` was written from the stored field and `listing_format`
   * from the creation form, which spelled the same two choices differently.
   * That duplication is part of what the rename ended in the app; here both
   * stay as they are, because a pinned property is a joinable one.
   */
  private static readonly GA_AUCTION_FORMAT: Record<string, string> = {
    bidding: 'highest-bid',
    offers: 'best-offer',
  };

  private static readonly GA_LISTING_FORMAT: Record<string, string> = {
    bidding: 'auction',
    offers: 'best-offer',
  };

  /** The `listing_format` value for a selling mode. See GA_LISTING_FORMAT. */
  listingFormatParam(sellingMode: string | null | undefined): string {
    if (!sellingMode) return '';
    return AnalyticsService.GA_LISTING_FORMAT[sellingMode] ?? sellingMode;
  }

  /** Common listing context for conversion events. */
  listingParams(listing: {
    _id?: string;
    slug?: string;
    sellingMode?: string;
    category?: string;
  }): AnalyticsEventParams {
    return {
      listing_id: listing._id ?? '',
      listing_slug: listing.slug ?? '',
      auction_format: listing.sellingMode
        ? (AnalyticsService.GA_AUCTION_FORMAT[listing.sellingMode] ?? listing.sellingMode)
        : '',
      item_category: listing.category ?? '',
    };
  }

  /** Gate is intentionally consent-independent — Consent Mode v2 (default set
   *  in index.html, upgraded by grantConsent()) controls whether hits are
   *  cookied or cookieless, not whether they're sent at all. */
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
