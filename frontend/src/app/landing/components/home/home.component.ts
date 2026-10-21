import {
  Component, OnDestroy, OnInit, AfterViewInit, inject, ElementRef, ViewChild,
  ChangeDetectorRef, NgZone, PLATFORM_ID, TransferState, makeStateKey, computed
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { getLocalizedTitle } from '../../../shared/utils/listing-locale';
import {
  listingImageSrc,
  listingImageSrcSet,
  onListingImageError
} from '../../../shared/utils/listing-image';
import { BidroomLogoComponent } from '../../../shared/components/bidroom-logo/bidroom-logo.component';
import { SeoService } from '../../../shared/services/seo.service';

/** Matches hero card width in CSS: min(380px, 78vw). */
const HERO_IMG_SIZES = 'min(380px, 78vw)';
/** Three-column grid collapses to 1fr under 900px. */
const GRID_IMG_SIZES = '(max-width: 900px) 100vw, 33vw';

const FEATURED_KEY = makeStateKey<Listing[]>('home:featured');

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, TranslateModule, HeaderComponent, BidroomLogoComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private translate = inject(TranslateService);
  private listingsService = inject(ListingsService);
  readonly themeService = inject(ThemeService);
  private router = inject(Router);
  private seo = inject(SeoService);
  private zone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);
  private transferState = inject(TransferState);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('carouselWrap') carouselWrap?: ElementRef<HTMLElement>;
  /** Set when `#salas` @defer block enters the DOM. */
  @ViewChild('salasSection')
  set salasSection(ref: ElementRef<HTMLElement> | undefined) {
    this._salasSection = ref;
    if (ref && this.isBrowser) this.observeSalasSection();
  }
  private _salasSection?: ElementRef<HTMLElement>;

  readonly isLight = computed(() => this.themeService.effective() === 'light');
  readonly heroImgSizes = HERO_IMG_SIZES;
  readonly gridImgSizes = GRID_IMG_SIZES;

  carouselCurrent = 0;
  featuredLoading = true;
  featuredListings: Listing[] = [];
  activeListings: Listing[] = [];

  // private room visualizer
  rvBid = '€ 12.800';
  rvTimer = '00:42';
  rvActiveIdx = 0;

  private readonly rbids = ['€ 12.800', '€ 13.200', '€ 13.600', '€ 14.200', '€ 14.900'];
  private ri = 0;
  private rs = 42;
  private timers: ReturnType<typeof setInterval>[] = [];
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private salasObserver: IntersectionObserver | null = null;
  private salasInView = false;
  private scrollRaf = 0;
  private touchStartX = 0;

  get CARDS(): number {
    return this.featuredListings.length || 1;
  }

  get currentLang(): string {
    return this.translate.currentLang || 'pt';
  }

  listingTitle(listing: Listing): string {
    return getLocalizedTitle(listing, this.currentLang);
  }

  get toggleLangLabel(): string {
    return this.currentLang === 'pt' ? 'EN' : 'PT';
  }

  ngOnInit(): void {
    const cached = this.transferState.get(FEATURED_KEY, null);
    if (cached?.length) {
      this.transferState.remove(FEATURED_KEY);
      this.featuredListings = cached;
      this.featuredLoading = false;
      this.seo.setHomeLcpPreload(cached[0]?.images?.[0] || null);
    } else {
      this.loadFeaturedListings();
    }

    // Wait for i18n — instant() during SSR returned raw keys in <title>.
    // setPage clears LCP preload, so re-apply after if featured is already known.
    this.translate.get(['seoPages.home.titleTag', 'seoPages.home.description']).subscribe(t => {
      this.seo.setPage({
        title: t['seoPages.home.titleTag'],
        description: t['seoPages.home.description'],
        path: '/',
      });
      const hero = this.featuredListings[0]?.images?.[0];
      if (hero) this.seo.setHomeLcpPreload(hero);
    });

    // Below-the-fold (@defer on viewport) — skip on SSR so whenStable() is faster.
    if (this.isBrowser) {
      this.loadActiveListings();
    }
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    this.startCarouselAuto();
    this.bindCarouselScroll();
    // salas observer starts via ViewChild setter when @defer renders #salas
  }

  ngOnDestroy(): void {
    this.stopPrivateRoomDemo();
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.salasObserver?.disconnect();
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    const wrap = this.carouselWrap?.nativeElement;
    if (wrap) wrap.removeEventListener('scroll', this.onCarouselScroll);
  }

  private loadFeaturedListings(): void {
    this.listingsService.getListings({ status: 'active', isFeatured: true, limit: 5, sort: 'deadline' }).subscribe({
      next: res => {
        this.featuredListings = res.listings;
        if (this.featuredListings.length === 0) {
          this.listingsService.getListings({ status: 'active', limit: 5, sort: 'deadline' }).subscribe({
            next: r => this.applyFeatured(r.listings),
            error: () => {
              this.featuredLoading = false;
              this.cdr.markForCheck();
            }
          });
        } else {
          this.applyFeatured(this.featuredListings);
        }
      },
      error: () => {
        this.featuredLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private applyFeatured(listings: Listing[]): void {
    this.featuredListings = listings;
    this.featuredLoading = false;
    this.carouselCurrent = 0;
    this.seo.setHomeLcpPreload(listings[0]?.images?.[0] || null);
    if (!this.isBrowser && listings.length) {
      this.transferState.set(FEATURED_KEY, listings);
    }
    this.cdr.markForCheck();
    if (this.isBrowser) queueMicrotask(() => this.scrollToSlide(0, false));
  }

  private loadActiveListings(): void {
    this.listingsService.getListings({ status: 'active', limit: 3, sort: 'deadline' }).subscribe({
      next: res => {
        this.activeListings = res.listings;
        this.cdr.markForCheck();
      }
    });
  }

  goTo(idx: number, skipAuto = false): void {
    if (this.featuredListings.length === 0) return;
    this.carouselCurrent = ((idx % this.CARDS) + this.CARDS) % this.CARDS;
    this.scrollToSlide(this.carouselCurrent, true);
    if (!skipAuto) this.resetCarouselAuto();
  }

  onCardClick(idx: number, listing: Listing): void {
    if (this.carouselCurrent === idx) {
      void this.router.navigate(['/listing', listing.slug]);
    } else {
      this.goTo(idx);
    }
  }

  onCarouselTouchStart(e: TouchEvent): void {
    this.touchStartX = e.touches[0].clientX;
  }

  onCarouselTouchEnd(e: TouchEvent): void {
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    if (Math.abs(dx) > 40) this.goTo(this.carouselCurrent + (dx < 0 ? 1 : -1));
  }

  listingPrice(l: Listing): string {
    if (l.saleFormat === 'giveaway') return this.translate.instant('GIVEAWAY.FREE');
    const p = l.currentPrice || l.startingPrice || l.minimumOfferPrice || 0;
    return `€ ${p.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  timeRemaining(l: Listing): string {
    if (l.saleFormat === 'giveaway') {
      const n = l.giveaway?.entryCount ?? 0;
      return n === 1
        ? this.translate.instant('GIVEAWAY.ONE_ENTRY')
        : this.translate.instant('GIVEAWAY.ENTRIES_COUNT', { count: n });
    }
    if (l.auctionFormat === 'best-offer') {
      return `${l.bidCount || 0} ofertas`;
    }
    const end = new Date(l.endDate).getTime();
    const diff = end - Date.now();
    if (diff <= 0) return 'Terminado';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      return `${d}d ${h % 24}h`;
    }
    if (h >= 1) return `${h}h ${m}m`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  listingBadge(l: Listing): string {
    if (l.saleFormat === 'giveaway') {
      return this.translate.instant('GIVEAWAY.PILL');
    }
    if (l.auctionFormat === 'best-offer') {
      return this.translate.instant('landing.home.badges.bestOffer');
    }
    if (l.allowPrivateRoom) {
      return this.translate.instant('landing.home.badges.privateRoom');
    }
    return this.translate.instant('landing.home.badges.auction');
  }

  isOfferBadge(l: Listing): boolean {
    return l.saleFormat === 'giveaway' || l.auctionFormat === 'best-offer';
  }

  isPrivateBadge(l: Listing): boolean {
    return l.saleFormat !== 'giveaway' && l.auctionFormat !== 'best-offer' && !!l.allowPrivateRoom;
  }

  isAuctionBadge(l: Listing): boolean {
    return l.saleFormat !== 'giveaway' && l.auctionFormat !== 'best-offer' && !l.allowPrivateRoom;
  }

  listingPriceLabel(l: Listing): string {
    if (l.saleFormat === 'giveaway') return 'GIVEAWAY.ENTRY_LABEL';
    return l.auctionFormat === 'best-offer' ? 'landing.home.listing.highestOffer' : 'landing.home.listing.currentBid';
  }

  /** Lightweight WebP for homepage cards; falls back to original via onImgError. */
  listingImage(l: Listing): string {
    return listingImageSrc(l.images?.[0], 'thumb');
  }

  listingImageSrcSet(l: Listing): string {
    return listingImageSrcSet(l.images?.[0]);
  }

  listingImageOriginal(l: Listing): string {
    return l.images?.[0] || '';
  }

  onImgError(event: Event, listing: Listing): void {
    onListingImageError(event, this.listingImageOriginal(listing));
  }

  /** Scroll-snap slide without measuring offsetWidth (avoids forced reflow). */
  private scrollToSlide(idx: number, smooth: boolean): void {
    const wrap = this.carouselWrap?.nativeElement;
    if (!wrap) return;
    const card = wrap.querySelectorAll<HTMLElement>('.hc')[idx];
    if (!card) return;
    card.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  private readonly onCarouselScroll = (): void => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.syncCarouselIndexFromScroll();
    });
  };

  private bindCarouselScroll(): void {
    const wrap = this.carouselWrap?.nativeElement;
    if (!wrap) return;
    this.zone.runOutsideAngular(() => {
      wrap.addEventListener('scroll', this.onCarouselScroll, { passive: true });
    });
  }

  private syncCarouselIndexFromScroll(): void {
    const wrap = this.carouselWrap?.nativeElement;
    if (!wrap || this.featuredListings.length === 0) return;
    const n = this.featuredListings.length;
    if (n <= 1) return;
    // Index from scroll progress only — no per-card offsetWidth (avoids forced reflow).
    const maxScroll = wrap.scrollWidth - wrap.clientWidth;
    const best = maxScroll <= 0
      ? 0
      : Math.min(n - 1, Math.max(0, Math.round((wrap.scrollLeft / maxScroll) * (n - 1))));
    if (best !== this.carouselCurrent) {
      this.zone.run(() => {
        this.carouselCurrent = best;
        this.cdr.detectChanges();
      });
    }
  }

  private startCarouselAuto(): void {
    this.zone.runOutsideAngular(() => {
      this.autoTimer = setInterval(() => {
        if (this.featuredListings.length <= 1) return;
        const next = (this.carouselCurrent + 1) % this.CARDS;
        this.zone.run(() => {
          this.carouselCurrent = next;
          this.scrollToSlide(next, true);
          this.cdr.detectChanges();
        });
      }, 4000);
    });
  }

  private resetCarouselAuto(): void {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.startCarouselAuto();
  }

  private observeSalasSection(): void {
    const el = this._salasSection?.nativeElement;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    this.salasObserver?.disconnect();
    this.salasInView = false;
    this.stopPrivateRoomDemo();

    this.zone.runOutsideAngular(() => {
      this.salasObserver = new IntersectionObserver(
        (entries) => {
          const visible = entries.some(e => e.isIntersecting);
          if (visible === this.salasInView) return;
          this.salasInView = visible;
          if (visible) this.startPrivateRoomDemo();
          else this.stopPrivateRoomDemo();
        },
        { rootMargin: '80px 0px', threshold: 0.15 }
      );
      this.salasObserver.observe(el);
    });
  }

  private startPrivateRoomDemo(): void {
    if (this.timers.length || !this.isBrowser) return;

    this.zone.runOutsideAngular(() => {
      this.timers.push(setInterval(() => {
        this.rvActiveIdx = (this.rvActiveIdx + 1) % 5;
        this.zone.run(() => this.cdr.detectChanges());
      }, 2000));

      this.timers.push(setInterval(() => {
        this.rs = this.rs > 0 ? this.rs - 1 : 58;
        const mm = String(Math.floor(this.rs / 60)).padStart(2, '0');
        const ss = String(this.rs % 60).padStart(2, '0');
        this.rvTimer = `${mm}:${ss}`;
        if (this.rs % 14 === 0) {
          this.ri = (this.ri + 1) % this.rbids.length;
          this.rvBid = this.rbids[this.ri];
        }
        this.zone.run(() => this.cdr.detectChanges());
      }, 1000));
    });
  }

  private stopPrivateRoomDemo(): void {
    this.timers.forEach(t => clearInterval(t));
    this.timers = [];
  }
}
