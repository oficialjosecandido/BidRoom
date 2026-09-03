import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
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

  ngOnInit(): void {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) || 'en';
    this.translate.use(saved);
  }
}
