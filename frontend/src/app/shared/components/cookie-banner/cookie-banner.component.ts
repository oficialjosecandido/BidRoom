import { Component, OnDestroy, OnInit, ElementRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { take } from 'rxjs/operators';
import { CookiePreferencesService } from '../../../landing/components/legal/cookie-preferences.service';
import { CustomerService } from '../../services/customer.service';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-cookie-banner',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './cookie-banner.component.html',
  styleUrls: ['./cookie-banner.component.scss']
})
export class CookieBannerComponent implements OnInit, OnDestroy {
  private readonly prefs          = inject(CookiePreferencesService);
  private readonly router         = inject(Router);
  private readonly elRef          = inject(ElementRef);
  private readonly authService    = inject(AuthService);
  private readonly customerService = inject(CustomerService);

  readonly visible = signal(false);

  /** ResizeObserver keeps the body padding in sync if the banner reflows */
  private resizeObserver?: ResizeObserver;

  ngOnInit(): void {
    if (this.prefs.hasConsent()) return;

    // If the user is already authenticated, fetch their saved consent from
    // the server before deciding to show the banner. This lets consent given
    // on one device suppress the banner on all other devices.
    const currentUser = this.authService.getCurrentUser();
    if (currentUser) {
      this.customerService.getCustomer().pipe(take(1)).subscribe({
        next: (info) => {
          if (info.cookieConsent) {
            this.prefs.syncFromServer(info.cookieConsent);
          } else {
            this.scheduleShow();
          }
        },
        error: () => this.scheduleShow()
      });
    } else {
      this.scheduleShow();
    }
  }

  ngOnDestroy(): void {
    this.clearBodyPadding();
    this.resizeObserver?.disconnect();
  }

  acceptAll(): void {
    this.prefs.acceptAll();
    this.saveToServer('all');
    this.hide();
  }

  rejectNonEssential(): void {
    this.prefs.rejectNonEssential();
    this.saveToServer('essential');
    this.hide();
  }

  private saveToServer(level: 'all' | 'essential'): void {
    if (!this.authService.getCurrentUser()) return;
    this.customerService.saveCookieConsent(level).pipe(take(1)).subscribe();
  }

  private scheduleShow(): void {
    setTimeout(() => {
      this.visible.set(true);
      // Wait one animation frame so the element is in the DOM and has size
      requestAnimationFrame(() => this.attachResizeObserver());
    }, 800);
  }

  openCookies(): void {
    this.hide();
    void this.router.navigate(['/landing/cookies']);
  }

  private hide(): void {
    this.visible.set(false);
    this.clearBodyPadding();
    this.resizeObserver?.disconnect();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private attachResizeObserver(): void {
    const bannerEl = this.elRef.nativeElement.querySelector('.cookie-banner') as HTMLElement | null;
    if (!bannerEl) return;

    this.applyBodyPadding(bannerEl.offsetHeight);

    this.resizeObserver = new ResizeObserver(entries => {
      const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? bannerEl.offsetHeight;
      this.applyBodyPadding(height);
    });
    this.resizeObserver.observe(bannerEl);
  }

  private applyBodyPadding(height: number): void {
    const px = `${height}px`;
    document.body.style.paddingBottom = px;
    document.documentElement.style.setProperty('--cookie-banner-height', px);
  }

  private clearBodyPadding(): void {
    document.body.style.paddingBottom = '';
    document.documentElement.style.setProperty('--cookie-banner-height', '0px');
  }
}
