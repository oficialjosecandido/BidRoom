import { Component, OnDestroy, OnInit, AfterViewInit, inject, ElementRef, ViewChild, HostListener } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { BidroomLogoComponent } from '../../../shared/components/bidroom-logo/bidroom-logo.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, HeaderComponent, BidroomLogoComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private translate = inject(TranslateService);
  private listingsService = inject(ListingsService);
  private themeService = inject(ThemeService);
  private router = inject(Router);

  @ViewChild('carouselWrap') carouselWrap!: ElementRef<HTMLElement>;
  @ViewChild('carouselTrack') carouselTrack!: ElementRef<HTMLElement>;

  get isLight(): boolean {
    return this.themeService.resolveEffective(this.themeService.preference()) === 'light';
  }

  carouselCurrent = 0;
  carouselTransform = 'translateX(0)';

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
  private touchStartX = 0;

  get CARDS(): number {
    return this.featuredListings.length || 1;
  }

  get currentLang(): string {
    return this.translate.currentLang || 'pt';
  }

  get toggleLangLabel(): string {
    return this.currentLang === 'pt' ? 'EN' : 'PT';
  }

  ngOnInit(): void {
    const saved = localStorage.getItem('lang') || 'pt';
    this.translate.use(saved);

    this.loadFeaturedListings();
    this.loadActiveListings();

    // private room timer animation
    this.timers.push(setInterval(() => {
      this.rvActiveIdx = (this.rvActiveIdx + 1) % 5;
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
    }, 1000));
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.updateCarouselTransform(), 0);
    this.startCarouselAuto();
  }

  ngOnDestroy(): void {
    this.timers.forEach(t => clearInterval(t));
    if (this.autoTimer) clearInterval(this.autoTimer);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateCarouselTransform();
  }

  private loadFeaturedListings(): void {
    this.listingsService.getListings({ status: 'active', isFeatured: true, limit: 5, sort: 'deadline' }).subscribe({
      next: res => {
        this.featuredListings = res.listings;
        // If no featured listings, fall back to first 5 active
        if (this.featuredListings.length === 0) {
          this.listingsService.getListings({ status: 'active', limit: 5, sort: 'deadline' }).subscribe({
            next: r => {
              this.featuredListings = r.listings;
              setTimeout(() => { this.carouselCurrent = 0; this.updateCarouselTransform(); }, 0);
            }
          });
        } else {
          setTimeout(() => { this.carouselCurrent = 0; this.updateCarouselTransform(); }, 0);
        }
      }
    });
  }

  private loadActiveListings(): void {
    this.listingsService.getListings({ status: 'active', limit: 3, sort: 'deadline' }).subscribe({
      next: res => { this.activeListings = res.listings; }
    });
  }


  goTo(idx: number, skipAuto = false): void {
    if (this.featuredListings.length === 0) return;
    this.carouselCurrent = ((idx % this.CARDS) + this.CARDS) % this.CARDS;
    this.updateCarouselTransform();
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

  /** Price to display for a listing (currentPrice, startingPrice, or minimumOfferPrice). */
  listingPrice(l: Listing): string {
    const p = l.currentPrice || l.startingPrice || l.minimumOfferPrice || 0;
    return `€ ${p.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  /** Time remaining label for a listing. */
  timeRemaining(l: Listing): string {
    if (l.auctionFormat === 'best-offer') {
      return `${l.bidCount || 0} ofertas`;
    }
    const end = new Date(l.endDate).getTime();
    const now = Date.now();
    const diff = end - now;
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

  /** Badge label for a listing card. */
  listingBadge(l: Listing): string {
    if (l.auctionFormat === 'best-offer') return 'Melhor oferta';
    if (l.allowPrivateRoom) return 'Sala Privada';
    return 'Ao vivo';
  }

  /** True if badge should use "live" (gold) style. */
  isLiveBadge(l: Listing): boolean {
    return l.auctionFormat !== 'best-offer' && !l.allowPrivateRoom;
  }

  /** Primary image for a listing. */
  listingImage(l: Listing): string {
    return l.images?.[0] || '';
  }

  private updateCarouselTransform(): void {
    const wrap = this.carouselWrap?.nativeElement;
    const track = this.carouselTrack?.nativeElement;
    if (!wrap || !track) return;
    const card = track.querySelector('.hc') as HTMLElement | null;
    if (!card) return;
    const cardW = card.offsetWidth + 16;
    const wrapW = wrap.offsetWidth;
    const offset = this.carouselCurrent * cardW - (wrapW / 2 - cardW / 2);
    this.carouselTransform = `translateX(${-offset}px)`;
  }

  private startCarouselAuto(): void {
    this.autoTimer = setInterval(() => {
      if (this.featuredListings.length > 1) {
        this.carouselCurrent = (this.carouselCurrent + 1) % this.CARDS;
        this.updateCarouselTransform();
      }
    }, 4000);
  }

  private resetCarouselAuto(): void {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.startCarouselAuto();
  }
}
