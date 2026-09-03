import { Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

const DISMISS_KEY = 'bidroom-pwa-install-dismissed';
const DISMISS_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Component({
  selector: 'app-pwa-install-banner',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './pwa-install-banner.component.html',
  styleUrls: ['./pwa-install-banner.component.scss']
})
export class PwaInstallBannerComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);

  readonly visible = signal(false);
  readonly canNativeInstall = signal(false);
  readonly isIos = signal(false);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private onBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    this.deferredPrompt = e as BeforeInstallPromptEvent;
    this.canNativeInstall.set(true);
    this.maybeShow();
  };

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.isStandalone()) return;
    if (this.isDismissed()) return;
    if (!this.isMobileDevice()) return;

    this.isIos.set(this.detectIos());

    window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);

    // iOS has no beforeinstallprompt — show manual instructions after a short delay.
    this.showTimer = setTimeout(() => this.maybeShow(), this.isIos() ? 1200 : 2500);
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    if (this.showTimer) clearTimeout(this.showTimer);
  }

  async install(): Promise<void> {
    if (!this.deferredPrompt) return;
    await this.deferredPrompt.prompt();
    await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.hide(true);
  }

  dismiss(): void {
    this.hide(true);
  }

  private maybeShow(): void {
    if (this.isStandalone() || this.isDismissed()) return;
    if (this.canNativeInstall() || this.isIos()) {
      this.visible.set(true);
    }
  }

  private hide(persistDismiss = false): void {
    this.visible.set(false);
    if (persistDismiss && typeof localStorage !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  }

  private isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  }

  private isDismissed(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  }

  private isMobileDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.matchMedia('(max-width: 768px)').matches;
    const ua = navigator.userAgent || '';
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    return (coarse && narrow) || mobileUa;
  }

  private detectIos(): boolean {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
}
