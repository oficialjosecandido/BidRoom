import { Component, OnDestroy, OnInit, ElementRef, inject, signal } from '@angular/core';
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
export class CookieBannerComponent implements OnInit, OnDestroy {
  private readonly prefs   = inject(CookiePreferencesService);
  private readonly router  = inject(Router);
  private readonly elRef   = inject(ElementRef);

  readonly visible = signal(false);

  /** ResizeObserver keeps the body padding in sync if the banner reflows */
  private resizeObserver?: ResizeObserver;

  ngOnInit(): void {
    if (this.prefs.hasConsent()) return;
    setTimeout(() => {
      this.visible.set(true);
      // Wait one animation frame so the element is in the DOM and has size
      requestAnimationFrame(() => this.attachResizeObserver());
    }, 800);
  }

  ngOnDestroy(): void {
    this.clearBodyPadding();
    this.resizeObserver?.disconnect();
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
    document.body.style.paddingBottom = `${height}px`;
  }

  private clearBodyPadding(): void {
    document.body.style.paddingBottom = '';
  }
}
