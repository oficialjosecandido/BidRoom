import { Component, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { SeoService } from './shared/services/seo.service';
import { CookieBannerComponent } from './shared/components/cookie-banner/cookie-banner.component';
import { PwaInstallBannerComponent } from './shared/components/pwa-install-banner/pwa-install-banner.component';
import { SupportChatWidgetComponent } from './shared/components/support-chat-widget/support-chat-widget.component';
import { AnalyticsService } from './shared/services/analytics.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CookieBannerComponent, PwaInstallBannerComponent, SupportChatWidgetComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('frontend');
  private translate = inject(TranslateService);
  /** Bootstraps GA in production when analytics cookies are accepted */
  private readonly _analytics = inject(AnalyticsService);

  private router = inject(Router);
  private seo = inject(SeoService);

  /**
   * Routes that build their own canonical from the entity they render
   * (SeoService.setListing / setBlogPost). Everything else gets a plain
   * self-referencing canonical derived from the URL.
   */
  private static readonly SELF_MANAGED_CANONICAL = ['/listing/', '/blog/', '/seller/'];

  ngOnInit(): void {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) || 'en';
    this.translate.use(saved);

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        const url = e.urlAfterRedirects;
        if (App.SELF_MANAGED_CANONICAL.some(p => url.startsWith(p))) return;
        this.seo.setCanonicalForRoute(url);
      });
  }
}
