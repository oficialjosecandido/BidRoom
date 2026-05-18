import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CookiePreferencesService } from '../../../landing/components/legal/cookie-preferences.service';

@Component({
  selector: 'app-cookie-banner',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './cookie-banner.component.html',
  styleUrls: ['./cookie-banner.component.scss']
})
export class CookieBannerComponent implements OnInit {
  private readonly prefs = inject(CookiePreferencesService);
  private readonly router = inject(Router);

  readonly visible = signal(false);

  ngOnInit(): void {
    if (this.prefs.hasConsent()) return;
    setTimeout(() => this.visible.set(true), 800);
  }

  acceptAll(): void {
    this.prefs.acceptAll();
    this.hide();
  }

  rejectNonEssential(): void {
    this.prefs.rejectNonEssential();
    this.hide();
  }

  openCookies(): void {
    this.hide();
    void this.router.navigate(['/landing/cookies']);
  }

  private hide(): void {
    this.visible.set(false);
  }
}
