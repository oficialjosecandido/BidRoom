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
  private loaded = false;
  private routerHooked = false;

  constructor() {
    if (!environment.production || !this.measurementId) return;

    effect(() => {
      if (this.cookiePrefs.analytics()) {
        this.enable();
      }
    });
  }

  private enable(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.injectGtag();
    this.hookRouter();
    this.trackPageView(this.router.url);
  }

  private injectGtag(): void {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag('js', new Date());
    window.gtag('config', this.measurementId!);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${this.measurementId}`;
    document.head.appendChild(script);
  }

  private hookRouter(): void {
    if (this.routerHooked) return;
    this.routerHooked = true;
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd)
    ).subscribe((e) => this.trackPageView(e.urlAfterRedirects));
  }

  private trackPageView(path: string): void {
    if (!window.gtag || !this.measurementId) return;
    window.gtag('config', this.measurementId, { page_path: path });
  }
}
